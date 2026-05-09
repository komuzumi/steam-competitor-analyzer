"use client";

import { GameAnalysis } from "@/types";
import { formatPrice, CurrencyCode } from "@/lib/currency";
import { estimateRevenue } from "@/lib/sales";

function formatNumber(n: number): string {
  return n.toLocaleString("ja-JP");
}

interface Props {
  results: GameAnalysis[];
  currency: CurrencyCode;
}

export default function ComparisonTable({ results, currency }: Props) {
  if (results.length < 2) return null;

  const fp = (n: number) => formatPrice(n, currency);

  return (
    <div className="bg-white rounded-xl shadow-md p-5 overflow-x-auto">
      <h3 className="text-lg font-bold text-gray-800 mb-4">比較テーブル</h3>
      <table className="w-full text-sm min-w-[600px]">
        <thead>
          <tr className="border-b-2 border-gray-200">
            <th className="text-left py-2 px-2 text-gray-600">項目</th>
            {results.map((r) => (
              <th key={r.appId} className="text-right py-2 px-2 text-gray-800 font-medium">
                {r.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Row label="定価" values={results.map((r) => fp(r.prices[currency]?.basePrice ?? 0))} />
          <Row label="現在価格" values={results.map((r) => {
            const p = r.prices[currency];
            if (!p) return "---";
            return p.discountPercent > 0
              ? `${fp(p.currentPrice)} (-${p.discountPercent}%)`
              : fp(p.currentPrice);
          })} />
          <Row label="過去最低価格" values={results.map((r) => {
            const p = r.prices[currency];
            return p?.historicalLow !== null && p?.historicalLow !== undefined ? fp(p.historicalLow) : "---";
          })} />
          <Row label="発売日" values={results.map((r) => r.releaseDate)} />
          <Row label="総レビュー数" values={results.map((r) => formatNumber(r.totalReviews))} />
          <Row label="Steam購入レビュー" values={results.map((r) => formatNumber(r.steamPurchaseReviews))} />
          <Row label="ポジティブ" values={results.map((r) => formatNumber(r.positiveReviews))} />
          <Row label="ネガティブ" values={results.map((r) => formatNumber(r.negativeReviews))} />
          <Row label="好評率" values={results.map((r) => `${r.positiveRate.toFixed(1)}%`)} highlight />
          <Row label="販売本数(保守)" values={results.map((r) => formatNumber(r.salesEstimate.conservative))} />
          <Row label="販売本数(標準)" values={results.map((r) => formatNumber(r.salesEstimate.standard))} highlight />
          <Row label="販売本数(強気)" values={results.map((r) => formatNumber(r.salesEstimate.aggressive))} />
          <Row label="売上(保守)" values={results.map((r) => fp(estimateRevenue(r.salesEstimate, r.prices[currency]?.basePrice ?? 0).conservative))} />
          <Row label="売上(標準)" values={results.map((r) => fp(estimateRevenue(r.salesEstimate, r.prices[currency]?.basePrice ?? 0).standard))} highlight />
          <Row label="売上(強気)" values={results.map((r) => fp(estimateRevenue(r.salesEstimate, r.prices[currency]?.basePrice ?? 0).aggressive))} />
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, values, highlight }: { label: string; values: string[]; highlight?: boolean }) {
  return (
    <tr className={`border-b border-gray-100 ${highlight ? "bg-blue-50" : ""}`}>
      <td className="py-2 px-2 text-gray-700 font-medium">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="text-right py-2 px-2 text-gray-800">
          {v}
        </td>
      ))}
    </tr>
  );
}
