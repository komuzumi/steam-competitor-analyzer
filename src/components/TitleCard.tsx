"use client";

import { GameAnalysis } from "@/types";
import { formatPrice, CurrencyCode } from "@/lib/currency";
import { estimateRevenue } from "@/lib/sales";

function formatNumber(n: number): string {
  return n.toLocaleString("ja-JP");
}

interface Props {
  data: GameAnalysis;
  currency: CurrencyCode;
}

export default function TitleCard({ data, currency }: Props) {
  const priceInfo = data.prices[currency];
  const fp = (n: number) => formatPrice(n, currency);
  const revenueEstimate = estimateRevenue(data.salesEstimate, priceInfo?.basePrice ?? 0);

  return (
    <div className="bg-white rounded-xl shadow-md overflow-hidden">
      {/* ヘッダー */}
      <div className="relative">
        {data.headerImage && (
          <img
            src={data.headerImage}
            alt={data.name}
            className="w-full h-48 object-cover"
          />
        )}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
          <h3 className="text-white text-xl font-bold">{data.name}</h3>
          <p className="text-gray-300 text-sm">
            AppID: {data.appId} | {data.releaseDate}
          </p>
        </div>
      </div>

      <div className="p-5 space-y-5">
        {/* 価格情報（エディション別） */}
        {data.editions.length > 0 && (
          <div>
            <h4 className="font-semibold text-gray-800 mb-2">価格情報</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-2 px-2 text-gray-600">エディション</th>
                    <th className="text-right py-2 px-2 text-gray-600">定価</th>
                    <th className="text-right py-2 px-2 text-gray-600">現在価格</th>
                    <th className="text-right py-2 px-2 text-gray-600">過去最低</th>
                  </tr>
                </thead>
                <tbody>
                  {data.editions.map((edition) => {
                    const ep = edition.prices[currency];
                    if (!ep) return null;
                    return (
                      <tr key={edition.packageId} className={`border-b border-gray-100 ${edition.isStandard ? "bg-blue-50" : ""}`}>
                        <td className="py-2 px-2 text-gray-700 font-medium">
                          {edition.displayName}
                        </td>
                        <td className="text-right py-2 px-2 text-gray-800">{fp(ep.basePrice)}</td>
                        <td className={`text-right py-2 px-2 ${ep.discountPercent > 0 ? "text-green-600 font-medium" : "text-gray-800"}`}>
                          {fp(ep.currentPrice)}
                          {ep.discountPercent > 0 && <span className="text-xs ml-1">(-{ep.discountPercent}%)</span>}
                        </td>
                        <td className="text-right py-2 px-2 text-gray-800">
                          {ep.historicalLow !== null ? fp(ep.historicalLow) : "---"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* レビュー概要 */}
        <div>
          <h4 className="font-semibold text-gray-800 mb-2">レビュー概要</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label="総レビュー数" value={formatNumber(data.totalReviews)} />
            <Stat label="Steam購入" value={formatNumber(data.steamPurchaseReviews)} />
            <Stat label="ポジティブ" value={formatNumber(data.positiveReviews)} color="text-green-600" />
            <Stat label="ネガティブ" value={formatNumber(data.negativeReviews)} color="text-red-600" />
          </div>
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">好評率:</span>
              <div className="flex-1 bg-gray-200 rounded-full h-4 overflow-hidden">
                <div
                  className="bg-green-500 h-full rounded-full transition-all"
                  style={{ width: `${data.positiveRate}%` }}
                />
              </div>
              <span className="text-sm font-medium text-gray-800">
                {data.positiveRate.toFixed(1)}%
              </span>
            </div>
          </div>
        </div>

        {/* 仮説販売本数・売上 */}
        <div>
          <h4 className="font-semibold text-gray-800 mb-2">仮説販売本数・売上</h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-1 text-gray-600">ケース</th>
                <th className="text-right py-1 text-gray-600">販売本数</th>
                <th className="text-right py-1 text-gray-600">売上</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="py-1 text-gray-700">保守</td>
                <td className="text-right text-gray-800">{formatNumber(data.salesEstimate.conservative)}</td>
                <td className="text-right text-gray-800">{fp(revenueEstimate.conservative)}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-1 text-gray-700 font-medium">標準</td>
                <td className="text-right text-gray-800 font-medium">{formatNumber(data.salesEstimate.standard)}</td>
                <td className="text-right text-gray-800 font-medium">{fp(revenueEstimate.standard)}</td>
              </tr>
              <tr>
                <td className="py-1 text-gray-700">強気</td>
                <td className="text-right text-gray-800">{formatNumber(data.salesEstimate.aggressive)}</td>
                <td className="text-right text-gray-800">{fp(revenueEstimate.aggressive)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 言語別 */}
        {data.languageStats.length > 0 && (
          <div>
            <h4 className="font-semibold text-gray-800 mb-2">言語別レビュー数（サンプル内）</h4>
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-1 text-gray-600">言語</th>
                    <th className="text-right py-1 text-gray-600">件数</th>
                    <th className="text-right py-1 text-gray-600">+</th>
                    <th className="text-right py-1 text-gray-600">-</th>
                  </tr>
                </thead>
                <tbody>
                  {data.languageStats.slice(0, 15).map((lang) => (
                    <tr key={lang.language} className="border-b border-gray-50">
                      <td className="py-1 text-gray-700">{lang.language}</td>
                      <td className="text-right text-gray-800">{lang.count}</td>
                      <td className="text-right text-green-600">{lang.positive}</td>
                      <td className="text-right text-red-600">{lang.negative}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* AI要約 */}
        {data.aiSummary && (
          <div>
            <h4 className="font-semibold text-gray-800 mb-2">AI分析レポート</h4>
            <div className="space-y-3">
              <SummarySection title="高評価の理由" content={data.aiSummary.positiveReasons} />
              <SummarySection title="低評価の理由" content={data.aiSummary.negativeReasons} />
              <SummarySection title="頻出する不満" content={data.aiSummary.frequentComplaints} />
              <SummarySection title="企画に活かせる示唆" content={data.aiSummary.planningInsights} />
              <SummarySection title="海外展開時の注意点" content={data.aiSummary.globalExpansionNotes} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3 text-center">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold ${color || "text-gray-800"}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function SummarySection({ title, content }: { title: string; content: string }) {
  return (
    <div className="bg-gray-50 rounded-lg p-3">
      <p className="text-sm font-medium text-gray-700 mb-1">{title}</p>
      <p className="text-sm text-gray-600 whitespace-pre-wrap">{content}</p>
    </div>
  );
}
