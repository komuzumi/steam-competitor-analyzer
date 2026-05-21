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
  timestamp_updated?: number;
  votes_up?: number;
  weighted_vote_score?: string;
}

export interface ReviewSummary {
  total_reviews: number;
  total_positive: number;
  total_negative: number;
  review_score_desc: string;
}

export interface LanguageStat {
  language: string;
  displayName?: string;
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

export interface RecentSalesEstimate {
  days: number;
  steamPurchaseReviewCount: number;
  isReviewCountCapped: boolean;
  copiesSoldEstimate: SalesEstimate;
}

export type EstimateCase = "conservative" | "standard" | "aggressive";
export type EstimateConfidence = "High" | "Medium" | "Low";

export interface MarketEstimateCase {
  ownersEstimate: number;
  steamCopiesSoldEstimate: number;
  grossRevenueEstimate: number;
  netRevenueAfterSteamFee: number;
  effectivePriceFactor: number;
}

export interface MarketEstimateMethod {
  id: "reviews" | "ccu" | "top_seller_rank" | "public_profiles";
  label: string;
  weight: number;
  status: "active" | "reserved" | "insufficient_data";
  estimate?: number;
  note: string;
}

export interface MarketEstimateExplanation {
  baseReviewMultiplier: number;
  adjustedReviewMultiplier: number;
  ageFactorLabel: string;
  priceFactor: number;
  reviewScoreFactor: number;
  playtimeFactor: number;
  averagePlaytimeHours: number | null;
  rawSteamPurchaseReviewShare: number | null;
  steamPurchaseReviewShare: number;
  multiplierClampRange: [number, number];
  steamFeeRate: number;
  usedData: string[];
  unusedData: string[];
  notes: string[];
}

export interface SteamMarketEstimate {
  conservative: MarketEstimateCase;
  standard: MarketEstimateCase;
  aggressive: MarketEstimateCase;
  confidence: EstimateConfidence;
  methods: MarketEstimateMethod[];
  explanation: MarketEstimateExplanation;
}

export interface AISummaryResult {
  positiveReasons: string;
  negativeReasons: string;
  frequentComplaints: string;
  planningInsights: string;
  globalExpansionNotes: string;
}

export interface AISampleMeta {
  mode: "representative" | "full_compressed";
  language: string;
  languageLabel: string;
  reviewCount: number;
  positiveCount: number;
  negativeCount: number;
  positiveRate: number;
  averagePlaytimeHours: number | null;
  oldestReviewDate: string | null;
  newestReviewDate: string | null;
  topLanguages: { language: string; count: number }[];
  selectionRule: string;
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
  marketEstimate: SteamMarketEstimate;
  currentPlayers: number | null;
  recentSalesEstimate: RecentSalesEstimate | null;
  prices: Record<string, CurrencyPriceInfo>;
  editions: EditionInfo[];
  reviewSamples: { text: string; language: string; votedUp: boolean; playtime: number }[];
  aiSummary?: AISummaryResult;
}

export interface AudienceOverlapGame {
  appId: string;
  name: string;
  headerImage: string;
  releaseDate: string;
  price: number;
  currency: string;
  estimatedCopiesSold: number;
  estimatedGrossRevenue: number;
  genres: string[];
  tags: string[];
  hybridScore: number;
  reviewOverlapPercent: number;
  reviewOverlapJaccard: number;
  sharedReviewers: number;
  targetReviewerSampleSize: number;
  candidateReviewerSampleSize: number;
  tagSimilarity: number;
  genreSimilarity: number;
  categorySimilarity: number;
  reasons: string[];
}

export interface AudienceOverlapResponse {
  appId: string;
  generatedAt: string;
  sourceNote: string;
  target: {
    appId: string;
    name: string;
    genres: string[];
    tags: string[];
    reviewerSampleSize: number;
  };
  alsoPlayed: AudienceOverlapGame[];
  reviewerOverlap: AudienceOverlapGame[];
  surprisingOverlap: AudienceOverlapGame[];
}

export interface PublicReview {
  recommendationid: string;
  language: string;
  review: string;
  voted_up: boolean;
  timestamp_created: number;
  timestamp_updated?: number;
  votes_up: number;
  weighted_vote_score: number;
  playtime_forever: number;
  playtime_at_review: number;
}

export interface AnalysisResponse {
  results: GameAnalysis[];
  errors: { appId: string; message: string }[];
}

export type SSEEvent =
  | { type: "progress"; appId: string; appName?: string; phase: string; detail?: string }
  | { type: "result"; data: GameAnalysis }
  | { type: "error"; appId: string; message: string }
  | { type: "done" };
