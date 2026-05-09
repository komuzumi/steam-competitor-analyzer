import { SteamReview, LanguageStat } from "@/types";

const STEAM_STORE_API = "https://store.steampowered.com/api";
const STEAM_REVIEW_API = "https://store.steampowered.com/appreviews";

export function extractAppId(input: string): string | null {
  const trimmed = input.trim();

  // 数字のみの場合はそのままAppID
  if (/^\d+$/.test(trimmed)) {
    return trimmed;
  }

  // Steam URLからAppIDを抽出
  const urlPattern = /store\.steampowered\.com\/app\/(\d+)/;
  const match = trimmed.match(urlPattern);
  if (match) {
    return match[1];
  }

  return null;
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
}

export async function fetchAppDetails(appId: string, cc: string = "jp"): Promise<SteamAppDetails> {
  const res = await fetch(`${STEAM_STORE_API}/appdetails?appids=${appId}&cc=${cc}&l=english`, {
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`Steam Store APIエラー: ${res.status}`);
  }

  const data = await res.json();
  const appData = data[appId];

  if (!appData || !appData.success) {
    throw new Error(`AppID ${appId} のデータが見つかりません`);
  }

  return appData.data;
}

export async function fetchReviews(
  appId: string,
  cursor: string = "*",
  filter: string = "all",
  numPerPage: number = 100
): Promise<{ reviews: SteamReview[]; cursor: string; total_reviews: number; total_positive: number; total_negative: number }> {
  const params = new URLSearchParams({
    json: "1",
    filter,
    language: "all",
    purchase_type: "all",
    num_per_page: String(numPerPage),
    cursor,
    review_type: "all",
  });

  const res = await fetch(`${STEAM_REVIEW_API}/${appId}?${params}`);

  if (!res.ok) {
    throw new Error(`Steam Review APIエラー: ${res.status}`);
  }

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

// maxReviews: 0 = 全件取得
export async function fetchAllReviews(
  appId: string,
  onProgress?: (fetched: number, total: number) => void,
  maxReviews: number = 0,
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
  let page = 0;

  while (true) {
    const result = await fetchReviews(appId, cursor);

    if (page === 0) {
      totalReviews = result.total_reviews;
      totalPositive = result.total_positive;
      totalNegative = result.total_negative;
    }

    if (!result.reviews.length) break;

    allReviews = allReviews.concat(result.reviews);
    cursor = result.cursor;
    page++;

    onProgress?.(Math.min(allReviews.length, totalReviews), totalReviews);

    // 上限または総数に達したら終了
    if (maxReviews > 0 && allReviews.length >= maxReviews) break;
    if (totalReviews > 0 && allReviews.length >= totalReviews) break;

    if (!cursor || cursor === "*") break;

    // レート制限対策（0.3秒間隔）
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return { reviews: allReviews, totalReviews, totalPositive, totalNegative };
}

// Steam購入レビュー数を取得
export async function fetchSteamPurchaseReviewCount(appId: string): Promise<number> {
  const params = new URLSearchParams({
    json: "1",
    filter: "all",
    language: "all",
    purchase_type: "steam",
    num_per_page: "0",
  });

  const res = await fetch(`${STEAM_REVIEW_API}/${appId}?${params}`);

  if (!res.ok) return 0;

  const data = await res.json();
  return data.query_summary?.total_reviews || 0;
}

export function aggregateByLanguage(reviews: SteamReview[]): LanguageStat[] {
  const langMap = new Map<string, { count: number; positive: number; negative: number }>();

  for (const review of reviews) {
    const lang = review.language;
    const existing = langMap.get(lang) || { count: 0, positive: 0, negative: 0 };
    existing.count++;
    if (review.voted_up) {
      existing.positive++;
    } else {
      existing.negative++;
    }
    langMap.set(lang, existing);
  }

  return Array.from(langMap.entries())
    .map(([language, stats]) => ({ language, ...stats }))
    .sort((a, b) => b.count - a.count);
}

export function parseReleaseYear(dateStr: string): number {
  // "Mar 15, 2023" or "2023年3月15日" etc.
  const yearMatch = dateStr.match(/(\d{4})/);
  if (yearMatch) {
    return parseInt(yearMatch[1], 10);
  }
  return new Date().getFullYear();
}
