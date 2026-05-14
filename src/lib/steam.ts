import { LanguageStat, PublicReview, SteamReview } from "@/types";

const STEAM_STORE_API = "https://store.steampowered.com/api";
const STEAM_REVIEW_API = "https://store.steampowered.com/appreviews";
const STEAM_CURRENT_PLAYERS_API = "https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1";
const STEAM_FETCH_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = STEAM_FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export const STEAM_LANGUAGES = [
  { code: "english", name: "English" },
  { code: "schinese", name: "Simplified Chinese" },
  { code: "russian", name: "Russian" },
  { code: "brazilian", name: "Portuguese - Brazil" },
  { code: "spanish", name: "Spanish - Spain" },
  { code: "latam", name: "Spanish - Latin America" },
  { code: "german", name: "German" },
  { code: "french", name: "French" },
  { code: "koreana", name: "Korean" },
  { code: "japanese", name: "Japanese" },
  { code: "polish", name: "Polish" },
  { code: "tchinese", name: "Traditional Chinese" },
  { code: "turkish", name: "Turkish" },
  { code: "thai", name: "Thai" },
  { code: "italian", name: "Italian" },
  { code: "ukrainian", name: "Ukrainian" },
  { code: "czech", name: "Czech" },
  { code: "portuguese", name: "Portuguese - Portugal" },
  { code: "hungarian", name: "Hungarian" },
  { code: "dutch", name: "Dutch" },
  { code: "vietnamese", name: "Vietnamese" },
  { code: "arabic", name: "Arabic" },
  { code: "finnish", name: "Finnish" },
  { code: "swedish", name: "Swedish" },
  { code: "danish", name: "Danish" },
  { code: "norwegian", name: "Norwegian" },
  { code: "romanian", name: "Romanian" },
  { code: "bulgarian", name: "Bulgarian" },
  { code: "greek", name: "Greek" },
];

const LANGUAGE_NAME_BY_CODE = new Map(STEAM_LANGUAGES.map((lang) => [lang.code, lang.name]));

export function getLanguageDisplayName(language: string): string {
  if (language === "all") return "All languages";
  if (language === "other") return "Other";
  return LANGUAGE_NAME_BY_CODE.get(language) ?? language;
}

export function extractAppId(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return trimmed;

  const match = trimmed.match(/store\.steampowered\.com\/app\/(\d+)/);
  return match ? match[1] : null;
}

interface PackageSub {
  packageid: number;
  percent_savings?: number;
  percent_savings_text?: string;
  option_text: string;
  price_in_cents_with_discount: number;
}

interface PackageGroup {
  subs: PackageSub[];
}

export interface SteamAppDetails {
  name: string;
  header_image: string;
  price_overview?: {
    initial: number;
    final: number;
    discount_percent: number;
    currency: string;
  };
  release_date?: {
    date: string;
  };
  is_free: boolean;
  package_groups?: PackageGroup[];
  genres?: { id: string; description: string }[];
  categories?: { id: number; description: string }[];
  developers?: string[];
  publishers?: string[];
  recommendations?: {
    total?: number;
  };
}

function cleanPackageName(optionText: string): string {
  return optionText
    .replace(/<[^>]*>/g, "")
    .replace(/S\$[\s]*[\d,.]+/g, "")
    .replace(/[¥$€£][\s]*[\d,.]+/g, "")
    .replace(/\s*-\s*$/, "")
    .trim();
}

function parseDiscountText(text?: string): number {
  const match = text?.match(/-(\d+)%/);
  return match ? parseInt(match[1], 10) : 0;
}

export interface EditionPrice {
  name: string;
  displayName: string;
  packageId: number;
  isStandard: boolean;
  basePrice: number;
  currentPrice: number;
  discountPercent: number;
}

export function extractEditionPrices(details: SteamAppDetails): EditionPrice[] {
  const subs = details.package_groups?.[0]?.subs;

  if (!subs?.length) {
    if (!details.price_overview) {
      return [
        {
          name: details.name,
          displayName: "通常版",
          packageId: 0,
          isStandard: true,
          basePrice: 0,
          currentPrice: 0,
          discountPercent: 0,
        },
      ];
    }

    return [
      {
        name: details.name,
        displayName: "通常版",
        packageId: 0,
        isStandard: true,
        basePrice: details.price_overview.initial / 100,
        currentPrice: details.price_overview.final / 100,
        discountPercent: details.price_overview.discount_percent,
      },
    ];
  }

  const gameName = details.name.toLowerCase();
  const editionKeywords =
    /\b(edition|bundle|pack|deluxe|premium|ultimate|legendary|gold|platinum|complete|collection|goty)\b/i;

  const editions = subs
    .filter((sub) => sub.price_in_cents_with_discount >= 0)
    .map((sub) => {
      const cleaned = cleanPackageName(sub.option_text);
      const isNameMatch = cleaned.toLowerCase() === gameName;
      const discount = parseDiscountText(sub.percent_savings_text);
      const currentPrice = sub.price_in_cents_with_discount / 100;
      const basePrice =
        discount > 0 ? Math.round((currentPrice / (1 - discount / 100)) * 100) / 100 : currentPrice;
      const prefix = `${details.name} - `;
      const displayName = isNameMatch ? "通常版" : cleaned.startsWith(prefix) ? cleaned.slice(prefix.length) : cleaned;

      return {
        name: cleaned,
        displayName,
        packageId: sub.packageid,
        isStandard: isNameMatch,
        basePrice,
        currentPrice,
        discountPercent: discount,
      };
    });

  if (!editions.some((edition) => edition.isStandard)) {
    const candidate = editions.find((edition) => !editionKeywords.test(edition.name));
    if (candidate) {
      candidate.isStandard = true;
      candidate.displayName = "通常版";
    } else if (editions[0]) {
      editions[0].isStandard = true;
    }
  }

  return editions.sort((a, b) => a.basePrice - b.basePrice);
}

export async function fetchAppDetails(appId: string, cc: string = "jp"): Promise<SteamAppDetails> {
  const res = await fetchWithTimeout(`${STEAM_STORE_API}/appdetails?appids=${appId}&cc=${cc}&l=english`, {
    next: { revalidate: 3600 },
  });

  if (!res.ok) throw new Error(`Steam Store API error: ${res.status}`);

  const data = await res.json();
  const appData = data[appId];
  if (!appData?.success) {
    throw new Error(`AppID ${appId} のストア情報が見つかりませんでした`);
  }

  return appData.data;
}

function decodeHtmlEntity(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchSteamTags(appId: string): Promise<string[]> {
  const res = await fetchWithTimeout(`https://store.steampowered.com/app/${appId}/?l=english`, {
    next: { revalidate: 3600 },
    headers: {
      cookie: "birthtime=568022401; mature_content=1",
    },
  });
  if (!res.ok) return [];

  const html = await res.text();
  const tags = [...html.matchAll(/<a[^>]*class="[^"]*\bapp_tag\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => decodeHtmlEntity(match[1].replace(/<[^>]*>/g, "")))
    .filter(Boolean);

  return Array.from(new Set(tags)).slice(0, 24);
}

export async function fetchSteamMoreLikeAppIds(appId: string): Promise<string[]> {
  const res = await fetchWithTimeout(`https://store.steampowered.com/recommended/morelike/app/${appId}/?l=english`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) return [];

  const html = await res.text();
  const ids = new Set<string>();
  for (const match of html.matchAll(/data-ds-appid="(\d+)"/g)) {
    if (match[1] !== appId) ids.add(match[1]);
  }
  for (const match of html.matchAll(/\/app\/(\d+)\//g)) {
    if (match[1] !== appId) ids.add(match[1]);
  }

  return Array.from(ids).slice(0, 40);
}

export interface ReviewSummary {
  totalReviews: number;
  totalPositive: number;
  totalNegative: number;
}

export async function fetchReviewSummary(
  appId: string,
  language: string = "all",
  purchaseType: "all" | "steam" = "all",
): Promise<ReviewSummary> {
  const params = new URLSearchParams({
    json: "1",
    filter: "all",
    language,
    purchase_type: purchaseType,
    num_per_page: "0",
    review_type: "all",
  });

  const res = await fetchWithTimeout(`${STEAM_REVIEW_API}/${appId}?${params}`);
  if (!res.ok) throw new Error(`Steam Review API error: ${res.status}`);

  const data = await res.json();
  if (!data.success) {
    throw new Error(`AppID ${appId} のレビュー概要取得に失敗しました`);
  }

  return {
    totalReviews: data.query_summary?.total_reviews || 0,
    totalPositive: data.query_summary?.total_positive || 0,
    totalNegative: data.query_summary?.total_negative || 0,
  };
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

export async function fetchLanguageStats(appId: string, allSummary?: ReviewSummary): Promise<LanguageStat[]> {
  const summary = allSummary ?? (await fetchReviewSummary(appId));
  const knownStats = await mapWithConcurrency(STEAM_LANGUAGES, 5, async (language) => {
    const langSummary = await fetchReviewSummary(appId, language.code).catch(() => ({
      totalReviews: 0,
      totalPositive: 0,
      totalNegative: 0,
    }));
    return {
      language: language.code,
      displayName: language.name,
      count: langSummary.totalReviews,
      positive: langSummary.totalPositive,
      negative: langSummary.totalNegative,
    };
  });

  const visibleStats = knownStats.filter((stat) => stat.count > 0);
  const knownCount = visibleStats.reduce((sum, stat) => sum + stat.count, 0);
  const knownPositive = visibleStats.reduce((sum, stat) => sum + stat.positive, 0);
  const knownNegative = visibleStats.reduce((sum, stat) => sum + stat.negative, 0);
  const otherCount = Math.max(summary.totalReviews - knownCount, 0);

  if (otherCount > 0) {
    visibleStats.push({
      language: "other",
      displayName: "Other",
      count: otherCount,
      positive: Math.max(summary.totalPositive - knownPositive, 0),
      negative: Math.max(summary.totalNegative - knownNegative, 0),
    });
  }

  return visibleStats.sort((a, b) => b.count - a.count);
}

export async function fetchReviews(
  appId: string,
  options: {
    cursor?: string;
    filter?: "all" | "recent" | "updated";
    language?: string;
    purchaseType?: "all" | "steam";
    reviewType?: "all" | "positive" | "negative";
    numPerPage?: number;
    dayRange?: number;
  } = {},
): Promise<{
  reviews: SteamReview[];
  cursor: string;
  total_reviews: number;
  total_positive: number;
  total_negative: number;
}> {
  const params = new URLSearchParams({
    json: "1",
    filter: options.filter ?? "recent",
    language: options.language ?? "all",
    purchase_type: options.purchaseType ?? "all",
    num_per_page: String(Math.min(options.numPerPage ?? 100, 100)),
    cursor: options.cursor ?? "*",
    review_type: options.reviewType ?? "all",
  });

  if (options.dayRange) params.set("day_range", String(options.dayRange));

  const res = await fetchWithTimeout(`${STEAM_REVIEW_API}/${appId}?${params}`);
  if (!res.ok) throw new Error(`Steam Review API error: ${res.status}`);

  const data = await res.json();
  if (!data.success) {
    throw new Error(`AppID ${appId} のレビュー取得に失敗しました`);
  }

  return {
    reviews: data.reviews || [],
    cursor: data.cursor || "",
    total_reviews: data.query_summary?.total_reviews || 0,
    total_positive: data.query_summary?.total_positive || 0,
    total_negative: data.query_summary?.total_negative || 0,
  };
}

export async function fetchAllReviews(
  appId: string,
  onProgress?: (fetched: number, total: number) => void,
  maxReviews: number = 0,
  language: string = "all",
): Promise<{
  reviews: SteamReview[];
  totalReviews: number;
  totalPositive: number;
  totalNegative: number;
}> {
  let allReviews: SteamReview[] = [];
  let cursor = "*";
  let totalReviews = 0;
  let totalPositive = 0;
  let totalNegative = 0;
  const seenCursors = new Set<string>();

  while (true) {
    const result = await fetchReviews(appId, { cursor, filter: "recent", numPerPage: 100, language });

    if (allReviews.length === 0) {
      totalReviews = result.total_reviews;
      totalPositive = result.total_positive;
      totalNegative = result.total_negative;
    }

    if (!result.reviews.length) break;

    allReviews = allReviews.concat(result.reviews);
    cursor = result.cursor;
    onProgress?.(Math.min(allReviews.length, totalReviews), totalReviews);

    if (maxReviews > 0 && allReviews.length >= maxReviews) {
      allReviews = allReviews.slice(0, maxReviews);
      break;
    }
    if (totalReviews > 0 && allReviews.length >= totalReviews) break;
    if (!cursor || cursor === "*" || seenCursors.has(cursor)) break;

    seenCursors.add(cursor);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return { reviews: allReviews, totalReviews, totalPositive, totalNegative };
}

function reviewRank(review: SteamReview): number {
  return Number(review.weighted_vote_score ?? 0) * 100_000 + Number(review.votes_up ?? 0) + review.timestamp_created / 1_000_000;
}

async function fetchReviewTypeSample(
  appId: string,
  reviewType: "positive" | "negative",
  target: number,
  language: string,
): Promise<SteamReview[]> {
  const reviews: SteamReview[] = [];
  let cursor = "*";
  const seenCursors = new Set<string>();

  while (reviews.length < target) {
    const result = await fetchReviews(appId, {
      cursor,
      filter: "all",
      reviewType,
      language,
      dayRange: 365,
      numPerPage: Math.min(100, target - reviews.length),
    });
    reviews.push(...result.reviews);
    cursor = result.cursor;

    if (!result.reviews.length) break;
    if (!cursor || cursor === "*" || seenCursors.has(cursor)) break;
    seenCursors.add(cursor);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return reviews.sort((a, b) => reviewRank(b) - reviewRank(a)).slice(0, target);
}

export async function fetchRepresentativeReviews(
  appId: string,
  limit: number = 200,
  language: string = "all",
): Promise<SteamReview[]> {
  const summary = await fetchReviewSummary(appId, language).catch(() => ({
    totalReviews: 0,
    totalPositive: 0,
    totalNegative: 0,
  }));
  const negativeShare = summary.totalReviews > 0 ? summary.totalNegative / summary.totalReviews : 0.3;
  const negativeTarget =
    summary.totalNegative > 0 ? Math.round(limit * Math.min(Math.max(negativeShare, 0.25), 0.5)) : 0;
  const positiveTarget = Math.max(limit - negativeTarget, 0);

  const [positive, negative] = await Promise.all([
    fetchReviewTypeSample(appId, "positive", positiveTarget, language),
    negativeTarget > 0 ? fetchReviewTypeSample(appId, "negative", negativeTarget, language) : Promise.resolve([]),
  ]);

  const byId = new Map<string, SteamReview>();
  for (const review of [...positive, ...negative]) byId.set(review.recommendationid, review);
  return Array.from(byId.values()).slice(0, limit);
}

export async function fetchSteamPurchaseReviewCount(appId: string): Promise<number> {
  const summary = await fetchReviewSummary(appId, "all", "steam");
  return summary.totalReviews;
}

export async function fetchRecentSteamPurchaseReviewCount(
  appId: string,
  days: number = 7,
  maxReviews: number = 1_500,
): Promise<{ count: number; isCapped: boolean }> {
  let cursor = "*";
  let count = 0;
  const seenCursors = new Set<string>();

  while (count < maxReviews) {
    const result = await fetchReviews(appId, {
      cursor,
      filter: "recent",
      language: "all",
      purchaseType: "steam",
      reviewType: "all",
      dayRange: days,
      numPerPage: Math.min(100, maxReviews - count),
    });

    if (!result.reviews.length) break;

    count += result.reviews.length;
    cursor = result.cursor;

    if (count >= maxReviews) return { count, isCapped: true };
    if (!cursor || cursor === "*" || seenCursors.has(cursor)) break;

    seenCursors.add(cursor);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return { count, isCapped: false };
}

export async function fetchCurrentPlayers(appId: string): Promise<number | null> {
  const params = new URLSearchParams({ appid: appId });
  const res = await fetchWithTimeout(`${STEAM_CURRENT_PLAYERS_API}?${params}`, undefined, 8_000);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.response?.result !== 1) return null;
  return Number(data.response?.player_count ?? 0);
}

export async function fetchReviewPlaytimeSample(appId: string): Promise<number | null> {
  const result = await fetchReviews(appId, {
    filter: "all",
    language: "all",
    reviewType: "all",
    numPerPage: 100,
  }).catch(() => null);
  if (!result?.reviews.length) return null;

  const playtimes = result.reviews
    .map((review) => review.author?.playtime_forever ?? 0)
    .filter((minutes) => minutes > 0);
  if (!playtimes.length) return null;

  const averageMinutes = playtimes.reduce((sum, minutes) => sum + minutes, 0) / playtimes.length;
  return Math.round((averageMinutes / 60) * 10) / 10;
}

export function toPublicReview(review: SteamReview): PublicReview {
  return {
    recommendationid: review.recommendationid,
    language: review.language,
    review: review.review,
    voted_up: review.voted_up,
    timestamp_created: review.timestamp_created,
    timestamp_updated: review.timestamp_updated,
    votes_up: Number(review.votes_up ?? 0),
    weighted_vote_score: Number(review.weighted_vote_score ?? 0),
    playtime_forever: review.author?.playtime_forever ?? 0,
    playtime_at_review: review.author?.playtime_at_review ?? 0,
  };
}

export function aggregateByLanguage(reviews: SteamReview[] | PublicReview[]): LanguageStat[] {
  const langMap = new Map<string, { count: number; positive: number; negative: number }>();

  for (const review of reviews) {
    const existing = langMap.get(review.language) || { count: 0, positive: 0, negative: 0 };
    existing.count++;
    if (review.voted_up) existing.positive++;
    else existing.negative++;
    langMap.set(review.language, existing);
  }

  return Array.from(langMap.entries())
    .map(([language, stats]) => ({
      language,
      displayName: getLanguageDisplayName(language),
      ...stats,
    }))
    .sort((a, b) => b.count - a.count);
}

export function parseReleaseYear(dateStr: string): number {
  const yearMatch = dateStr.match(/(\d{4})/);
  return yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();
}
