import { SalesEstimate, RevenueEstimate } from "@/types";

// レビュー倍率テーブル（発売年別）
// Boxleiterメソッドベース + 年代補正
const REVIEW_MULTIPLIER: Record<string, { conservative: number; standard: number; aggressive: number }> = {
  "2024": { conservative: 20, standard: 30, aggressive: 50 },
  "2023": { conservative: 20, standard: 30, aggressive: 50 },
  "2022": { conservative: 25, standard: 35, aggressive: 55 },
  "2021": { conservative: 25, standard: 40, aggressive: 60 },
  "2020": { conservative: 30, standard: 45, aggressive: 65 },
  "2019": { conservative: 30, standard: 50, aggressive: 70 },
  "2018": { conservative: 35, standard: 50, aggressive: 75 },
  "2017": { conservative: 35, standard: 55, aggressive: 80 },
  "2016": { conservative: 40, standard: 55, aggressive: 80 },
  "2015": { conservative: 40, standard: 60, aggressive: 85 },
  default: { conservative: 30, standard: 45, aggressive: 65 },
};

// 実効単価係数
const EFFECTIVE_PRICE_COEFFICIENT = {
  conservative: 0.45,
  standard: 0.60,
  aggressive: 0.75,
};

export function estimateSales(totalReviews: number, releaseYear: number): SalesEstimate {
  const yearKey = String(releaseYear);
  const multiplier = REVIEW_MULTIPLIER[yearKey] || REVIEW_MULTIPLIER["default"];

  return {
    conservative: totalReviews * multiplier.conservative,
    standard: totalReviews * multiplier.standard,
    aggressive: totalReviews * multiplier.aggressive,
  };
}

export function estimateRevenue(salesEstimate: SalesEstimate, price: number): RevenueEstimate {
  return {
    conservative: Math.round(salesEstimate.conservative * price * EFFECTIVE_PRICE_COEFFICIENT.conservative),
    standard: Math.round(salesEstimate.standard * price * EFFECTIVE_PRICE_COEFFICIENT.standard),
    aggressive: Math.round(salesEstimate.aggressive * price * EFFECTIVE_PRICE_COEFFICIENT.aggressive),
  };
}
