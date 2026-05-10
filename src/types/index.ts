export interface SteamReview {
  recommendationid: string;
  author: {
    steamid: string;
    playtime_forever: number;
    playtime_at_review: number;
  };
  language: string;
  review: string;
  voted_up: boolean;
  timestamp_created: number;
}

export interface ReviewSummary {
  total_reviews: number;
  total_positive: number;
  total_negative: number;
  review_score_desc: string;
}

export interface LanguageStat {
  language: string;
  count: number;
  positive: number;
  negative: number;
}

export interface SalesEstimate {
  conservative: number;
  standard: number;
  aggressive: number;
}

export interface RevenueEstimate {
  conservative: number;
  standard: number;
  aggressive: number;
}

export interface AISummaryResult {
  positiveReasons: string;
  negativeReasons: string;
  frequentComplaints: string;
  planningInsights: string;
  globalExpansionNotes: string;
}

export interface CurrencyPriceInfo {
  basePrice: number;
  currentPrice: number;
  discountPercent: number;
  historicalLow: number | null;
  historicalLowDate: string | null;
}

export interface EditionInfo {
  name: string;
  displayName: string;
  packageId: number;
  isStandard: boolean;
  prices: Record<string, CurrencyPriceInfo>;
}

export interface GameAnalysis {
  appId: string;
  name: string;
  headerImage: string;
  releaseDate: string;
  releaseYear: number;
  totalReviews: number;
  steamPurchaseReviews: number;
  positiveReviews: number;
  negativeReviews: number;
  positiveRate: number;
  languageStats: LanguageStat[];
  salesEstimate: SalesEstimate;
  prices: Record<string, CurrencyPriceInfo>;
  editions: EditionInfo[];
  reviewSamples: { text: string; language: string; votedUp: boolean; playtime: number }[];
  aiSummary?: AISummaryResult;
}

export interface AnalysisResponse {
  results: GameAnalysis[];
  errors: { appId: string; message: string }[];
}

// SSEイベント型
export type SSEEvent =
  | { type: "progress"; appId: string; appName?: string; phase: string; detail?: string }
  | { type: "result"; data: GameAnalysis }
  | { type: "error"; appId: string; message: string }
  | { type: "done" };
