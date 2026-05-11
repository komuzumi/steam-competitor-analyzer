"use client";

import { GameAnalysis } from "@/types";
import { formatPrice, CurrencyCode } from "@/lib/currency";
import { estimateNetRevenue, estimateRevenue } from "@/lib/sales";

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("ja-JP");
}

interface Props {
  results: GameAnalysis[];
  currency: CurrencyCode;
}

export default function ComparisonTable({ results, currency }: Props) {
  if (results.length < 2) return null;

  const fp = (n: number) => formatPrice(n, currency);

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-lg font-bold text-slate-900">比較サマリー</h3>
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="border-b-2 border-slate-200">
            <th className="px-2 py-2 text-left text-slate-600">項目</th>
            {results.map((result) => (
              <th key={result.appId} className="px-2 py-2 text-right font-medium text-slate-900">
                {result.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <Row label="定価" values={results.map((r) => fp(r.prices[currency]?.basePrice ?? 0))} />
          <Row
            label="現在価格"
            values={results.map((r) => {
              const p = r.prices[currency];
              if (!p) return "-";
              return p.discountPercent > 0 ? `${fp(p.currentPrice)} (-${p.discountPercent}%)` : fp(p.currentPrice);
            })}
          />
          <Row label="発売日" values={results.map((r) => r.releaseDate)} />
          <Row label="現在同時接続者" values={results.map((r) => (r.currentPlayers == null ? "取得不可" : formatNumber(r.currentPlayers)))} />
          <Row label="総レビュー数" values={results.map((r) => formatNumber(r.totalReviews))} />
          <Row label="Steam購入レビュー" values={results.map((r) => formatNumber(r.steamPurchaseReviews))} />
          <Row label="好評率" values={results.map((r) => `${r.positiveRate.toFixed(1)}%`)} highlight />
          <Row label="推定所有者(標準)" values={results.map((r) => formatNumber(r.marketEstimate.standard.ownersEstimate))} />
          <Row label="推定Steam販売本数(標準)" values={results.map((r) => formatNumber(r.salesEstimate.standard))} highlight />
          <Row
            label="総売上(標準)"
            values={results.map((r) => fp(estimateRevenue(r.salesEstimate, r.prices[currency]?.basePrice ?? 0).standard))}
          />
          <Row
            label="手数料控除後(標準)"
            values={results.map((r) => fp(estimateNetRevenue(estimateRevenue(r.salesEstimate, r.prices[currency]?.basePrice ?? 0)).standard))}
            highlight
          />
          <Row label="推定信頼度" values={results.map((r) => r.marketEstimate.confidence)} />
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, values, highlight }: { label: string; values: string[]; highlight?: boolean }) {
  return (
    <tr className={`border-b border-slate-100 ${highlight ? "bg-blue-50" : ""}`}>
      <td className="px-2 py-2 font-medium text-slate-700">{label}</td>
      {values.map((value, index) => (
        <td key={index} className="px-2 py-2 text-right text-slate-800">
          {value}
        </td>
      ))}
    </tr>
  );
}
