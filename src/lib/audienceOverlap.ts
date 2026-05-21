import { AudienceOverlapGame, AudienceOverlapResponse } from "@/types";
import { CurrencyCode, getCurrencyOption } from "@/lib/currency";
import { estimateSteamMarket } from "@/lib/sales";
import {
  extractEditionPrices,
  fetchAppDetails,
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
    const [candidateReviewers, reviewSummary, steamPurchaseReviews, averagePlaytimeHours, usdDetails] = await Promise.all([
      fetchReviewAuthorSample(candidate.appId, 400).catch(() => new Set<string>()),
      fetchReviewSummary(candidate.appId).catch(() => ({ totalReviews: 0, totalPositive: 0, totalNegative: 0 })),
      fetchSteamPurchaseReviewCount(candidate.appId).catch(() => 0),
      fetchReviewPlaytimeSample(candidate.appId).catch(() => null),
      options.currency === "USD" ? Promise.resolve(candidate.details) : fetchAppDetails(candidate.appId, "us").catch(() => candidate.details),
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

    return {
      appId: candidate.appId,
      name: candidate.details.name,
      headerImage: candidate.details.header_image,
      releaseDate,
      price: displayPrice,
      currency: options.currency,
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
    };
  } catch {
    return null;
  }
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
  const candidateAppIds = unique([...moreLikeAppIds, ...STATIC_CANDIDATE_APP_IDS])
    .filter((candidateId) => candidateId !== appId)
    .slice(0, 48);
  const allCandidateMetadata = (
    await mapWithConcurrency(candidateAppIds, 4, (candidateId) =>
      fetchCandidateMetadata(candidateId, currencyOption.steamCC, targetGenres, targetCategories, targetTags),
    )
  )
    .filter((candidate): candidate is CandidateMetadata => Boolean(candidate))
    .sort((a, b) => b.metadataScore - a.metadataScore);
  const strongMetadataMatches = allCandidateMetadata.slice(0, 12);
  const exploratoryMetadataMatches = allCandidateMetadata
    .slice(12)
    .filter((candidate) => candidate.metadataScore < 45)
    .sort((a, b) => (b.details.recommendations?.total ?? 0) - (a.details.recommendations?.total ?? 0))
    .slice(0, 8);
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

  return {
    appId,
    generatedAt: new Date().toISOString(),
    sourceNote:
      "Steam公開情報だけを使った推定です。レビュー投稿者IDはAPI処理中の重なり計算にだけ使い、保存・返却しません。",
    target: {
      appId,
      name: targetDetails.name,
      genres: targetGenres,
      tags: targetTags,
      reviewerSampleSize: targetReviewers.size,
    },
    alsoPlayed: [...enrichedCandidates].sort((a, b) => b.hybridScore - a.hybridScore).slice(0, 10),
    reviewerOverlap: [...enrichedCandidates]
      .sort((a, b) => b.reviewOverlapPercent - a.reviewOverlapPercent || b.hybridScore - a.hybridScore)
      .slice(0, 10),
    surprisingOverlap: [...enrichedCandidates]
      .filter((candidate) => candidate.sharedReviewers > 0 && candidate.tagSimilarity < 35)
      .sort((a, b) => getReviewSurpriseScore(b) - getReviewSurpriseScore(a))
      .slice(0, 10),
  };
}
