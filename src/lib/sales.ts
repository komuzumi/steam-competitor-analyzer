import {
  EstimateConfidence,
  MarketEstimateCase,
  RevenueEstimate,
  SalesEstimate,
  SteamMarketEstimate,
} from "@/types";

const EFFECTIVE_PRICE_COEFFICIENT = {
  conservative: 0.45,
  standard: 0.6,
  aggressive: 0.75,
};

const STEAM_FEE_RATE = 0.3;
const REVIEW_MULTIPLIER_RANGE: [number, number] = [18, 85];

interface SteamMarketEstimateInput {
  totalReviews: number;
  steamPurchaseReviews: number;
  releaseYear: number;
  priceForMultiplier: number;
  basePriceForRevenue: number;
  positiveRate: number;
  averagePlaytimeHours?: number | null;
  isFree?: boolean;
  currentPlayers?: number | null;
  currentYear?: number;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getAgeMultiplier(releaseYear: number, currentYear: number): { multiplier: number; label: string } {
  const age = Math.max(currentYear - releaseYear, 0);
  if (age <= 1) return { multiplier: 28, label: "発売から1年以内" };
  if (age <= 2) return { multiplier: 32, label: "発売から2年以内" };
  if (age <= 4) return { multiplier: 38, label: "発売から4年以内" };
  if (age <= 7) return { multiplier: 45, label: "発売から7年以内" };
  if (age <= 10) return { multiplier: 52, label: "発売から10年以内" };
  return { multiplier: 60, label: "発売から10年以上" };
}

function getPriceFactor(price: number): number {
  if (price <= 0) return 0.85;
  if (price < 5) return 0.85;
  if (price < 15) return 1;
  if (price < 30) return 1.08;
  if (price < 60) return 1.15;
  return 1.2;
}

function getReviewScoreFactor(positiveRate: number): number {
  if (positiveRate >= 95) return 1.12;
  if (positiveRate >= 90) return 1.05;
  if (positiveRate >= 80) return 1;
  if (positiveRate >= 70) return 0.95;
  return 0.9;
}

function getPlaytimeFactor(averagePlaytimeHours?: number | null): number {
  if (averagePlaytimeHours == null || Number.isNaN(averagePlaytimeHours)) return 1;
  if (averagePlaytimeHours < 1) return 0.75;
  if (averagePlaytimeHours < 5) return 0.9;
  if (averagePlaytimeHours < 20) return 1;
  if (averagePlaytimeHours < 50) return 1.08;
  return 1.15;
}

function getConfidence(input: SteamMarketEstimateInput): EstimateConfidence {
  if (input.isFree || input.basePriceForRevenue <= 0 || input.totalReviews < 1_000) return "Low";
  if (input.totalReviews >= 10_000 && input.steamPurchaseReviews > 0) return "High";
  return "Medium";
}

function makeCase(
  ownersEstimate: number,
  steamPurchaseReviewShare: number,
  basePriceForRevenue: number,
  effectivePriceFactor: number,
): MarketEstimateCase {
  const steamCopiesSoldEstimate = Math.round(ownersEstimate * steamPurchaseReviewShare);
  const grossRevenueEstimate = Math.round(steamCopiesSoldEstimate * basePriceForRevenue * effectivePriceFactor);
  return {
    ownersEstimate: Math.round(ownersEstimate),
    steamCopiesSoldEstimate,
    grossRevenueEstimate,
    netRevenueAfterSteamFee: Math.round(grossRevenueEstimate * (1 - STEAM_FEE_RATE)),
    effectivePriceFactor,
  };
}

export function estimateSteamMarket(input: SteamMarketEstimateInput): SteamMarketEstimate {
  const currentYear = input.currentYear ?? new Date().getFullYear();
  const age = getAgeMultiplier(input.releaseYear, currentYear);
  const priceFactor = getPriceFactor(input.priceForMultiplier);
  const reviewScoreFactor = getReviewScoreFactor(input.positiveRate);
  const playtimeFactor = getPlaytimeFactor(input.averagePlaytimeHours);
  const rawMultiplier = age.multiplier * priceFactor * reviewScoreFactor * playtimeFactor;
  const adjustedReviewMultiplier = clamp(rawMultiplier, REVIEW_MULTIPLIER_RANGE[0], REVIEW_MULTIPLIER_RANGE[1]);
  const standardOwners = input.totalReviews * adjustedReviewMultiplier;

  const rawSteamPurchaseReviewShare =
    input.totalReviews > 0 && input.steamPurchaseReviews > 0
      ? input.steamPurchaseReviews / input.totalReviews
      : null;
  const steamPurchaseReviewShare = rawSteamPurchaseReviewShare == null ? 1 : clamp(rawSteamPurchaseReviewShare, 0.35, 1);

  const conservativeOwners = standardOwners * 0.75;
  const aggressiveOwners = standardOwners * 1.25;

  const usedData = [
    "総レビュー数",
    "Steam購入レビュー比率",
    "発売年",
    "価格帯",
    "好評率",
  ];
  if (input.averagePlaytimeHours != null) usedData.push("レビュー投稿者の平均プレイ時間サンプル");
  if (input.currentPlayers != null) usedData.push("現在同時接続者数（表示とスナップショット用）");

  const notes = [
    "Gamalyticの公開記事で触れられているレビュー倍率法を参考にした独自実装です。",
    "同時接続者数は現時点では売上推定に混ぜず、履歴が30日以上貯まった後の補助推定として予約しています。",
    "トップセラー順位と公開プロフィール推定は、取得元と運用ルールが固まるまで重み0の予約メソッドです。",
  ];
  if (input.isFree) {
    notes.push("無料ゲームのベースゲーム売上は推定信頼度をLowにしています。IAP/DLC売上は今回の対象外です。");
  }

  return {
    conservative: makeCase(
      conservativeOwners,
      steamPurchaseReviewShare,
      input.basePriceForRevenue,
      EFFECTIVE_PRICE_COEFFICIENT.conservative,
    ),
    standard: makeCase(
      standardOwners,
      steamPurchaseReviewShare,
      input.basePriceForRevenue,
      EFFECTIVE_PRICE_COEFFICIENT.standard,
    ),
    aggressive: makeCase(
      aggressiveOwners,
      steamPurchaseReviewShare,
      input.basePriceForRevenue,
      EFFECTIVE_PRICE_COEFFICIENT.aggressive,
    ),
    confidence: getConfidence(input),
    methods: [
      {
        id: "reviews",
        label: "レビュー倍率法",
        weight: 1,
        status: "active",
        estimate: Math.round(standardOwners),
        note: "レビュー数に発売年、価格帯、好評率、平均プレイ時間の補正をかけて所有者数を推定します。",
      },
      {
        id: "ccu",
        label: "同時接続者数ベース推定",
        weight: 0,
        status: "insufficient_data",
        note: "現在値は表示しますが、30日以上の履歴が貯まるまで売上推定には混ぜません。",
      },
      {
        id: "top_seller_rank",
        label: "トップセラー順位推定",
        weight: 0,
        status: "reserved",
        note: "安定した取得元と規約確認が済むまで予約メソッドとして扱います。",
      },
      {
        id: "public_profiles",
        label: "公開プロフィール推定",
        weight: 0,
        status: "reserved",
        note: "プロフィールサンプリングの運用負荷が高いため、初期実装では使いません。",
      },
    ],
    explanation: {
      baseReviewMultiplier: age.multiplier,
      adjustedReviewMultiplier,
      ageFactorLabel: age.label,
      priceFactor,
      reviewScoreFactor,
      playtimeFactor,
      averagePlaytimeHours: input.averagePlaytimeHours ?? null,
      rawSteamPurchaseReviewShare,
      steamPurchaseReviewShare,
      multiplierClampRange: REVIEW_MULTIPLIER_RANGE,
      steamFeeRate: STEAM_FEE_RATE,
      usedData,
      unusedData: ["同時接続者数履歴", "トップセラー順位", "公開プロフィールpolling"],
      notes,
    },
  };
}

export function salesEstimateFromMarket(marketEstimate: SteamMarketEstimate): SalesEstimate {
  return {
    conservative: marketEstimate.conservative.steamCopiesSoldEstimate,
    standard: marketEstimate.standard.steamCopiesSoldEstimate,
    aggressive: marketEstimate.aggressive.steamCopiesSoldEstimate,
  };
}

export function estimateRecentSteamCopiesFromReviews(
  steamPurchaseReviewCount: number,
  marketEstimate: SteamMarketEstimate,
): SalesEstimate {
  const multiplier = marketEstimate.explanation.adjustedReviewMultiplier;
  return {
    conservative: Math.round(steamPurchaseReviewCount * multiplier * 0.75),
    standard: Math.round(steamPurchaseReviewCount * multiplier),
    aggressive: Math.round(steamPurchaseReviewCount * multiplier * 1.25),
  };
}

export function revenueEstimateFromMarket(marketEstimate: SteamMarketEstimate): RevenueEstimate {
  return {
    conservative: marketEstimate.conservative.grossRevenueEstimate,
    standard: marketEstimate.standard.grossRevenueEstimate,
    aggressive: marketEstimate.aggressive.grossRevenueEstimate,
  };
}

export function netRevenueEstimateFromMarket(marketEstimate: SteamMarketEstimate): RevenueEstimate {
  return {
    conservative: marketEstimate.conservative.netRevenueAfterSteamFee,
    standard: marketEstimate.standard.netRevenueAfterSteamFee,
    aggressive: marketEstimate.aggressive.netRevenueAfterSteamFee,
  };
}

export function estimateRevenue(salesEstimate: SalesEstimate, price: number): RevenueEstimate {
  return {
    conservative: Math.round(salesEstimate.conservative * price * EFFECTIVE_PRICE_COEFFICIENT.conservative),
    standard: Math.round(salesEstimate.standard * price * EFFECTIVE_PRICE_COEFFICIENT.standard),
    aggressive: Math.round(salesEstimate.aggressive * price * EFFECTIVE_PRICE_COEFFICIENT.aggressive),
  };
}

export function estimateNetRevenue(revenueEstimate: RevenueEstimate): RevenueEstimate {
  return {
    conservative: Math.round(revenueEstimate.conservative * (1 - STEAM_FEE_RATE)),
    standard: Math.round(revenueEstimate.standard * (1 - STEAM_FEE_RATE)),
    aggressive: Math.round(revenueEstimate.aggressive * (1 - STEAM_FEE_RATE)),
  };
}
