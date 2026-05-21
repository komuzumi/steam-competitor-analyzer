import {
  AudienceClassification,
  AudienceOverlapGame,
  AudienceOverlapResponse,
  RecentReviewActivity,
} from "@/types";
import { CurrencyCode, getCurrencyOption } from "@/lib/currency";
import { estimateSteamMarket } from "@/lib/sales";
import {
  extractEditionPrices,
  fetchAppDetails,
  fetchCurrentPlayers,
  fetchRecentSteamPurchaseReviewCount,
  fetchReviewPlaytimeSample,
  fetchReviews,
  fetchReviewSummary,
  fetchSteamMoreLikeAppIds,
  fetchSteamPurchaseReviewCount,
  fetchSteamTags,
  parseReleaseYear,
  SteamAppDetails,
} from "@/lib/steam";

const STATIC_CANDIDATE_APP_IDS = [
  "730",
  "570",
  "440",
  "550",
  "620",
  "105600",
  "1085660",
  "1172470",
  "1245620",
  "1364780",
  "1372280",
  "1384160",
  "1623730",
  "1778820",
  "1794680",
  "1966720",
  "2073850",
  "218620",
  "221100",
  "230410",
  "242760",
  "252490",
  "264710",
  "275850",
  "304930",
  "322330",
  "346110",
  "367520",
  "389730",
  "413150",
  "427520",
  "526870",
  "548430",
  "578080",
  "582010",
  "632360",
  "646570",
  "648800",
  "739630",
  "892970",
  "976310",
  "107410",
  "1086940",
  "1091500",
  "1145360",
  "1172620",
  "1326470",
  "1971870",
  "2379780",
];

interface CandidateMetadata {
  appId: string;
  details: SteamAppDetails;
  genres: string[];
  categories: string[];
  tags: string[];
  metadataScore: number;
}

interface BuildAudienceOverlapOptions {
  appId: string;
  currency: CurrencyCode;
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function jaccardPercent(left: string[], right: string[]): number {
  const leftSet = new Set(left.map(normalize).filter(Boolean));
  const rightSet = new Set(right.map(normalize).filter(Boolean));
  if (!leftSet.size || !rightSet.size) return 0;

  let overlap = 0;
  for (const item of leftSet) {
    if (rightSet.has(item)) overlap++;
  }
  const union = leftSet.size + rightSet.size - overlap;
  return union > 0 ? (overlap / union) * 100 : 0;
}

function intersectLabels(left: string[], right: string[], maxItems = 4): string[] {
  const normalizedRight = new Map(right.map((item) => [normalize(item), item]));
  return left
    .filter((item) => normalizedRight.has(normalize(item)))
    .map((item) => normalizedRight.get(normalize(item)) || item)
    .slice(0, maxItems);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getGenres(details: SteamAppDetails): string[] {
  return unique((details.genres ?? []).map((genre) => genre.description));
}

function getCategories(details: SteamAppDetails): string[] {
  return unique((details.categories ?? []).map((category) => category.description));
}

function getBasePrice(details: SteamAppDetails): number {
  if (details.is_free) return 0;
  const standardEdition = extractEditionPrices(details).find((edition) => edition.isStandard);
  return standardEdition?.basePrice ?? (details.price_overview?.initial ?? 0) / 100;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const currentIndex = index++;
      results[currentIndex] = await mapper(items[currentIndex]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function fetchReviewAuthorSample(appId: string, maxReviews: number): Promise<Set<string>> {
  const steamIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor = "*";

  while (steamIds.size < maxReviews) {
    const result = await fetchReviews(appId, {
      cursor,
      filter: "all",
      language: "all",
      reviewType: "all",
      purchaseType: "all",
      numPerPage: Math.min(100, maxReviews - steamIds.size),
    });

    for (const review of result.reviews) {
      if (review.author?.steamid) steamIds.add(review.author.steamid);
    }

    cursor = result.cursor;
    if (!result.reviews.length) break;
    if (!cursor || cursor === "*" || seenCursors.has(cursor)) break;
    seenCursors.add(cursor);
    await new Promise((resolve) => setTimeout(resolve, 180));
  }

  return steamIds;
}

function getMetadataScore(
  candidate: Pick<CandidateMetadata, "genres" | "categories" | "tags">,
  targetGenres: string[],
  targetCategories: string[],
  targetTags: string[],
): number {
  const tagSimilarity = jaccardPercent(targetTags, candidate.tags);
  const genreSimilarity = jaccardPercent(targetGenres, candidate.genres);
  const categorySimilarity = jaccardPercent(targetCategories, candidate.categories);
  return tagSimilarity * 0.5 + genreSimilarity * 0.3 + categorySimilarity * 0.2;
}

async function fetchCandidateMetadata(
  appId: string,
  steamCC: string,
  targetGenres: string[],
  targetCategories: string[],
  targetTags: string[],
): Promise<CandidateMetadata | null> {
  try {
    const [details, tags] = await Promise.all([fetchAppDetails(appId, steamCC), fetchSteamTags(appId).catch(() => [])]);
    const genres = getGenres(details);
    const categories = getCategories(details);
    const metadataScore = getMetadataScore({ genres, categories, tags }, targetGenres, targetCategories, targetTags);

    return {
      appId,
      details,
      genres,
      categories,
      tags,
      metadataScore,
    };
  } catch {
    return null;
  }
}

function countSharedReviewers(left: Set<string>, right: Set<string>): number {
  let shared = 0;
  const smaller = left.size <= right.size ? left : right;
  const larger = left.size <= right.size ? right : left;

  for (const item of smaller) {
    if (larger.has(item)) shared++;
  }

  return shared;
}

function buildReasons({
  sharedReviewers,
  commonTags,
  commonGenres,
  commonCategories,
}: {
  sharedReviewers: number;
  commonTags: string[];
  commonGenres: string[];
  commonCategories: string[];
}): string[] {
  const reasons: string[] = [];
  if (sharedReviewers > 0) reasons.push(`共通レビュー投稿者 ${sharedReviewers.toLocaleString("ja-JP")}人`);
  if (commonTags.length) reasons.push(`共通タグ: ${commonTags.join(", ")}`);
  if (commonGenres.length) reasons.push(`共通ジャンル: ${commonGenres.join(", ")}`);
  if (commonCategories.length) reasons.push(`共通カテゴリ: ${commonCategories.join(", ")}`);
  return reasons.length ? reasons : ["公開メタ情報の近さから候補化"];
}

function getReviewSurpriseScore(candidate: AudienceOverlapGame): number {
  if (candidate.sharedReviewers <= 0) return 0;
  return candidate.reviewOverlapPercent * Math.max(100 - candidate.tagSimilarity, 0);
}

function getClassification(input: {
  sharedReviewers: number;
  reviewOverlapPercent: number;
  tagSimilarity: number;
  genreSimilarity: number;
  categorySimilarity: number;
}): { classification: AudienceClassification; label: string; reason: string } {
  if (input.tagSimilarity >= 40 && input.genreSimilarity >= 70) {
    return {
      classification: "direct_competitor",
      label: "直接競合",
      reason: "タグとジャンルが近く、同じ棚で比較されやすい候補です。",
    };
  }

  if (input.sharedReviewers > 0 && input.tagSimilarity < 35) {
    return {
      classification: "surprising_link",
      label: "意外な関連",
      reason: "タグは離れていますが、同じ投稿者がレビューしている候補です。",
    };
  }

  if (input.sharedReviewers > 0 && input.reviewOverlapPercent >= 0.2) {
    return {
      classification: "fanbase_neighbor",
      label: "ファン層近接",
      reason: "同じ投稿者の重なりがあり、ユーザー関心が近い可能性があります。",
    };
  }

  if (input.genreSimilarity >= 50 || input.tagSimilarity >= 20 || input.categorySimilarity >= 35) {
    return {
      classification: "adjacent_genre",
      label: "近接ジャンル",
      reason: "タグやカテゴリが部分的に近く、比較対象に入りやすい候補です。",
    };
  }

  if (input.sharedReviewers > 0) {
    return {
      classification: "fanbase_neighbor",
      label: "ファン層近接",
      reason: "同じ投稿者の重なりがあり、ユーザー関心が近い可能性があります。",
    };
  }

  return {
    classification: "adjacent_genre",
    label: "近接ジャンル",
    reason: "Steamの関連候補や公開メタ情報から拾った候補です。投稿者一致は検出されていません。",
  };
}

function getMomentum(
  recentReviewActivity7d: RecentReviewActivity,
  currentPlayers: number | null,
): { score: number; label: string; reasons: string[] } {
  const reviewCountScore = Math.min(Math.log10(recentReviewActivity7d.reviewCount + 1) * 18, 45);
  const shareScore = Math.min(recentReviewActivity7d.reviewShareOfTotal * 12, 35);
  const ccuScore = currentPlayers == null ? 0 : Math.min(Math.log10(currentPlayers + 1) * 5, 20);
  const score = Math.round(clamp(reviewCountScore + shareScore + ccuScore, 0, 100));
  const label = score >= 70 ? "急伸" : score >= 45 ? "堅調" : score >= 20 ? "微増" : "静か";
  const reasons = [
    `直近${recentReviewActivity7d.days}日レビュー: ${recentReviewActivity7d.isCapped ? ">= " : ""}${recentReviewActivity7d.reviewCount.toLocaleString("ja-JP")}件`,
    `総レビュー比: ${recentReviewActivity7d.reviewShareOfTotal.toFixed(2)}%`,
  ];
  if (currentPlayers != null) reasons.push(`現在同接: ${currentPlayers.toLocaleString("ja-JP")}人`);
  if (recentReviewActivity7d.isCapped) reasons.push("取得上限到達のため下限評価");
  return { score, label, reasons };
}

function getEstimateDiagnostics(input: {
  totalReviews: number;
  steamPurchaseReviews: number;
  price: number;
  averagePlaytimeHours: number | null;
  recentReviewActivity7d: RecentReviewActivity;
}): string[] {
  const diagnostics: string[] = [];

  if (input.totalReviews >= 10_000) diagnostics.push("レビュー数が多く、推定は比較的安定");
  else if (input.totalReviews >= 1_000) diagnostics.push("レビュー数は中規模で、推定は標準的");
  else diagnostics.push("レビュー数が少なく、推定のブレが大きい");

  if (input.price <= 0) diagnostics.push("無料/価格不明のため売上推定は弱め");

  if (input.totalReviews > 0 && input.steamPurchaseReviews > 0) {
    const steamShare = input.steamPurchaseReviews / input.totalReviews;
    if (steamShare < 0.5) diagnostics.push("Steam購入レビュー比率が低く、キー配布/バンドル影響の可能性");
  } else {
    diagnostics.push("Steam購入レビュー比率を十分に確認できない");
  }

  if (input.averagePlaytimeHours == null) diagnostics.push("平均プレイ時間サンプル不足");
  if (input.recentReviewActivity7d.isCapped) diagnostics.push("直近レビュー取得が上限到達のため勢いは下限表示");

  return diagnostics.slice(0, 4);
}

function selectSurprisingOverlap(candidates: AudienceOverlapGame[]): AudienceOverlapGame[] {
  const strict = candidates
    .filter((candidate) => candidate.sharedReviewers > 0 && candidate.tagSimilarity < 55)
    .sort((a, b) => getReviewSurpriseScore(b) - getReviewSurpriseScore(a));
  const selected = new Map(strict.map((candidate) => [candidate.appId, candidate]));

  const fallback = candidates
    .filter((candidate) => candidate.sharedReviewers > 0 && !selected.has(candidate.appId))
    .sort(
      (a, b) =>
        getReviewSurpriseScore(b) - getReviewSurpriseScore(a) ||
        b.reviewOverlapPercent - a.reviewOverlapPercent ||
        a.tagSimilarity - b.tagSimilarity,
    );

  return [...strict, ...fallback].slice(0, 10);
}

async function enrichCandidate(
  candidate: CandidateMetadata,
  options: {
    currency: CurrencyCode;
    targetGenres: string[];
    targetCategories: string[];
    targetTags: string[];
    targetReviewers: Set<string>;
  },
): Promise<AudienceOverlapGame | null> {
  try {
    const [
      candidateReviewers,
      reviewSummary,
      steamPurchaseReviews,
      averagePlaytimeHours,
      usdDetails,
      currentPlayers,
      recentSteamPurchaseReviews7d,
    ] = await Promise.all([
      fetchReviewAuthorSample(candidate.appId, 400).catch(() => new Set<string>()),
      fetchReviewSummary(candidate.appId).catch(() => ({ totalReviews: 0, totalPositive: 0, totalNegative: 0 })),
      fetchSteamPurchaseReviewCount(candidate.appId).catch(() => 0),
      fetchReviewPlaytimeSample(candidate.appId).catch(() => null),
      options.currency === "USD"
        ? Promise.resolve(candidate.details)
        : fetchAppDetails(candidate.appId, "us").catch(() => candidate.details),
      fetchCurrentPlayers(candidate.appId).catch(() => null),
      fetchRecentSteamPurchaseReviewCount(candidate.appId, 7, 300).catch(() => null),
    ]);

    const sharedReviewers = countSharedReviewers(options.targetReviewers, candidateReviewers);
    const targetReviewerSampleSize = options.targetReviewers.size;
    const candidateReviewerSampleSize = candidateReviewers.size;
    const reviewOverlapPercent =
      targetReviewerSampleSize > 0 ? (sharedReviewers / targetReviewerSampleSize) * 100 : 0;
    const reviewOverlapJaccard =
      targetReviewerSampleSize + candidateReviewerSampleSize - sharedReviewers > 0
        ? (sharedReviewers / (targetReviewerSampleSize + candidateReviewerSampleSize - sharedReviewers)) * 100
        : 0;
    const tagSimilarity = jaccardPercent(options.targetTags, candidate.tags);
    const genreSimilarity = jaccardPercent(options.targetGenres, candidate.genres);
    const categorySimilarity = jaccardPercent(options.targetCategories, candidate.categories);
    const releaseDate = candidate.details.release_date?.date || "Unknown";
    const releaseYear = parseReleaseYear(releaseDate);
    const positiveRate =
      reviewSummary.totalReviews > 0 ? (reviewSummary.totalPositive / reviewSummary.totalReviews) * 100 : 0;
    const recentReviewActivity7d: RecentReviewActivity = {
      days: 7,
      reviewCount: recentSteamPurchaseReviews7d?.count ?? 0,
      isCapped: recentSteamPurchaseReviews7d?.isCapped ?? false,
      reviewShareOfTotal:
        reviewSummary.totalReviews > 0 ? ((recentSteamPurchaseReviews7d?.count ?? 0) / reviewSummary.totalReviews) * 100 : 0,
    };
    const displayPrice = getBasePrice(candidate.details);
    const usdPrice = getBasePrice(usdDetails);
    const marketEstimate = estimateSteamMarket({
      totalReviews: reviewSummary.totalReviews,
      steamPurchaseReviews,
      releaseYear,
      priceForMultiplier: usdPrice,
      basePriceForRevenue: displayPrice,
      positiveRate,
      averagePlaytimeHours,
      isFree: candidate.details.is_free,
    });
    const hybridScore = clamp(
      reviewOverlapPercent * 4 +
        reviewOverlapJaccard * 6 +
        tagSimilarity * 0.38 +
        genreSimilarity * 0.28 +
        categorySimilarity * 0.18 +
        (sharedReviewers > 0 ? 8 : 0),
      0,
      100,
    );
    const commonTags = intersectLabels(options.targetTags, candidate.tags);
    const commonGenres = intersectLabels(options.targetGenres, candidate.genres);
    const commonCategories = intersectLabels(options.targetCategories, candidate.categories, 3);
    const classification = getClassification({
      sharedReviewers,
      reviewOverlapPercent,
      tagSimilarity,
      genreSimilarity,
      categorySimilarity,
    });
    const momentum = getMomentum(recentReviewActivity7d, currentPlayers);

    return {
      appId: candidate.appId,
      name: candidate.details.name,
      headerImage: candidate.details.header_image,
      classification: classification.classification,
      classificationLabel: classification.label,
      classificationReason: classification.reason,
      releaseDate,
      price: displayPrice,
      currency: options.currency,
      totalReviews: reviewSummary.totalReviews,
      positiveRate,
      steamPurchaseReviews,
      averagePlaytimeHours,
      currentPlayers,
      recentReviewActivity7d,
      momentumScore: momentum.score,
      momentumLabel: momentum.label,
      momentumReasons: momentum.reasons,
      estimatedCopiesSold: marketEstimate.standard.steamCopiesSoldEstimate,
      estimatedGrossRevenue: marketEstimate.standard.grossRevenueEstimate,
      genres: candidate.genres,
      tags: candidate.tags,
      hybridScore: Math.round(hybridScore * 10) / 10,
      reviewOverlapPercent: Math.round(reviewOverlapPercent * 100) / 100,
      reviewOverlapJaccard: Math.round(reviewOverlapJaccard * 100) / 100,
      sharedReviewers,
      targetReviewerSampleSize,
      candidateReviewerSampleSize,
      tagSimilarity: Math.round(tagSimilarity * 10) / 10,
      genreSimilarity: Math.round(genreSimilarity * 10) / 10,
      categorySimilarity: Math.round(categorySimilarity * 10) / 10,
      reasons: buildReasons({ sharedReviewers, commonTags, commonGenres, commonCategories }),
      estimateDiagnostics: getEstimateDiagnostics({
        totalReviews: reviewSummary.totalReviews,
        steamPurchaseReviews,
        price: displayPrice,
        averagePlaytimeHours,
        recentReviewActivity7d,
      }),
    };
  } catch {
    return null;
  }
}

async function buildTargetGame(options: {
  appId: string;
  currency: CurrencyCode;
  details: SteamAppDetails;
  genres: string[];
  categories: string[];
  tags: string[];
  targetReviewers: Set<string>;
}): Promise<AudienceOverlapGame> {
  const [reviewSummary, steamPurchaseReviews, averagePlaytimeHours, usdDetails, currentPlayers, recentSteamPurchaseReviews7d] =
    await Promise.all([
      fetchReviewSummary(options.appId).catch(() => ({ totalReviews: 0, totalPositive: 0, totalNegative: 0 })),
      fetchSteamPurchaseReviewCount(options.appId).catch(() => 0),
      fetchReviewPlaytimeSample(options.appId).catch(() => null),
      options.currency === "USD" ? Promise.resolve(options.details) : fetchAppDetails(options.appId, "us").catch(() => options.details),
      fetchCurrentPlayers(options.appId).catch(() => null),
      fetchRecentSteamPurchaseReviewCount(options.appId, 7, 300).catch(() => null),
    ]);
  const releaseDate = options.details.release_date?.date || "Unknown";
  const positiveRate =
    reviewSummary.totalReviews > 0 ? (reviewSummary.totalPositive / reviewSummary.totalReviews) * 100 : 0;
  const recentReviewActivity7d: RecentReviewActivity = {
    days: 7,
    reviewCount: recentSteamPurchaseReviews7d?.count ?? 0,
    isCapped: recentSteamPurchaseReviews7d?.isCapped ?? false,
    reviewShareOfTotal:
      reviewSummary.totalReviews > 0 ? ((recentSteamPurchaseReviews7d?.count ?? 0) / reviewSummary.totalReviews) * 100 : 0,
  };
  const price = getBasePrice(options.details);
  const marketEstimate = estimateSteamMarket({
    totalReviews: reviewSummary.totalReviews,
    steamPurchaseReviews,
    releaseYear: parseReleaseYear(releaseDate),
    priceForMultiplier: getBasePrice(usdDetails),
    basePriceForRevenue: price,
    positiveRate,
    averagePlaytimeHours,
    isFree: options.details.is_free,
  });
  const momentum = getMomentum(recentReviewActivity7d, currentPlayers);

  return {
    appId: options.appId,
    name: options.details.name,
    headerImage: options.details.header_image,
    classification: "target",
    classificationLabel: "対象",
    classificationReason: "分析対象タイトルです。",
    releaseDate,
    price,
    currency: options.currency,
    totalReviews: reviewSummary.totalReviews,
    positiveRate,
    steamPurchaseReviews,
    averagePlaytimeHours,
    currentPlayers,
    recentReviewActivity7d,
    momentumScore: momentum.score,
    momentumLabel: momentum.label,
    momentumReasons: momentum.reasons,
    estimatedCopiesSold: marketEstimate.standard.steamCopiesSoldEstimate,
    estimatedGrossRevenue: marketEstimate.standard.grossRevenueEstimate,
    genres: options.genres,
    tags: options.tags,
    hybridScore: 100,
    reviewOverlapPercent: 100,
    reviewOverlapJaccard: 100,
    sharedReviewers: options.targetReviewers.size,
    targetReviewerSampleSize: options.targetReviewers.size,
    candidateReviewerSampleSize: options.targetReviewers.size,
    tagSimilarity: 100,
    genreSimilarity: 100,
    categorySimilarity: 100,
    reasons: ["分析対象タイトル"],
    estimateDiagnostics: getEstimateDiagnostics({
      totalReviews: reviewSummary.totalReviews,
      steamPurchaseReviews,
      price,
      averagePlaytimeHours,
      recentReviewActivity7d,
    }),
  };
}

export async function buildAudienceOverlap({
  appId,
  currency,
}: BuildAudienceOverlapOptions): Promise<AudienceOverlapResponse> {
  const currencyOption = getCurrencyOption(currency);
  const [targetDetails, targetTags, moreLikeAppIds, targetReviewers] = await Promise.all([
    fetchAppDetails(appId, currencyOption.steamCC),
    fetchSteamTags(appId).catch(() => []),
    fetchSteamMoreLikeAppIds(appId).catch(() => []),
    fetchReviewAuthorSample(appId, 800).catch(() => new Set<string>()),
  ]);
  const targetGenres = getGenres(targetDetails);
  const targetCategories = getCategories(targetDetails);
  const targetGame = await buildTargetGame({
    appId,
    currency,
    details: targetDetails,
    genres: targetGenres,
    categories: targetCategories,
    tags: targetTags,
    targetReviewers,
  });
  const candidateAppIds = unique([...moreLikeAppIds.slice(0, 32), ...STATIC_CANDIDATE_APP_IDS])
    .filter((candidateId) => candidateId !== appId)
    .slice(0, 64);
  const allCandidateMetadata = (
    await mapWithConcurrency(candidateAppIds, 4, (candidateId) =>
      fetchCandidateMetadata(candidateId, currencyOption.steamCC, targetGenres, targetCategories, targetTags),
    )
  )
    .filter((candidate): candidate is CandidateMetadata => Boolean(candidate))
    .sort((a, b) => b.metadataScore - a.metadataScore);
  const strongMetadataMatches = allCandidateMetadata.slice(0, 14);
  const exploratoryMetadataMatches = allCandidateMetadata
    .slice(14)
    .filter((candidate) => candidate.metadataScore < 55)
    .sort((a, b) => (b.details.recommendations?.total ?? 0) - (a.details.recommendations?.total ?? 0))
    .slice(0, 12);
  const candidateMetadata = unique([...strongMetadataMatches, ...exploratoryMetadataMatches].map((candidate) => candidate.appId))
    .map((candidateId) => allCandidateMetadata.find((candidate) => candidate.appId === candidateId))
    .filter((candidate): candidate is CandidateMetadata => Boolean(candidate));

  const enrichedCandidates = (
    await mapWithConcurrency(candidateMetadata, 3, (candidate) =>
      enrichCandidate(candidate, {
        currency,
        targetGenres,
        targetCategories,
        targetTags,
        targetReviewers,
      }),
    )
  ).filter((candidate): candidate is AudienceOverlapGame => Boolean(candidate));

  const competitors = [...enrichedCandidates].sort(
    (a, b) => b.hybridScore - a.hybridScore || b.momentumScore - a.momentumScore,
  );

  return {
    appId,
    generatedAt: new Date().toISOString(),
    sourceNote: "Steam公開情報だけを使った推定です。実プレイヤー全体の重複率ではありません。",
    target: {
      appId,
      name: targetDetails.name,
      genres: targetGenres,
      tags: targetTags,
      reviewerSampleSize: targetReviewers.size,
    },
    targetGame,
    competitors,
    alsoPlayed: competitors.slice(0, 10),
    reviewerOverlap: [...enrichedCandidates]
      .sort((a, b) => b.reviewOverlapPercent - a.reviewOverlapPercent || b.hybridScore - a.hybridScore)
      .slice(0, 10),
    surprisingOverlap: selectSurprisingOverlap(enrichedCandidates),
  };
}
