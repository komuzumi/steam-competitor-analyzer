"use client";

import { GameAnalysis } from "@/types";
import { CurrencyCode, formatPrice } from "@/lib/currency";
import { estimateRevenue } from "@/lib/sales";
import LanguageChart from "@/components/LanguageChart";
import ReviewTools from "@/components/ReviewTools";

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
    <div className="overflow-hidden rounded-xl bg-white shadow-md">
      <div className="relative">
        {data.headerImage && (
          <img src={data.headerImage} alt={data.name} className="h-48 w-full object-cover" />
        )}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
          <h3 className="text-xl font-bold text-white">{data.name}</h3>
          <p className="text-sm text-gray-300">
            AppID: {data.appId} | {data.releaseDate}
          </p>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {data.editions.length > 0 && (
          <div>
            <h4 className="mb-2 font-semibold text-gray-800">価格情報</h4>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="px-2 py-2 text-left text-gray-600">エディション</th>
                    <th className="px-2 py-2 text-right text-gray-600">定価</th>
                    <th className="px-2 py-2 text-right text-gray-600">現在価格</th>
                    <th className="px-2 py-2 text-right text-gray-600">過去最安</th>
                  </tr>
                </thead>
                <tbody>
                  {data.editions.map((edition) => {
                    const ep = edition.prices[currency];
                    if (!ep) return null;
                    return (
                      <tr
                        key={edition.packageId}
                        className={`border-b border-gray-100 ${edition.isStandard ? "bg-blue-50" : ""}`}
                      >
                        <td className="px-2 py-2 font-medium text-gray-700">{edition.displayName}</td>
                        <td className="px-2 py-2 text-right text-gray-800">{fp(ep.basePrice)}</td>
                        <td
                          className={`px-2 py-2 text-right ${
                            ep.discountPercent > 0 ? "font-medium text-green-600" : "text-gray-800"
                          }`}
                        >
                          {fp(ep.currentPrice)}
                          {ep.discountPercent > 0 && <span className="ml-1 text-xs">(-{ep.discountPercent}%)</span>}
                        </td>
                        <td className="px-2 py-2 text-right text-gray-800">
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

        <div>
          <h4 className="mb-2 font-semibold text-gray-800">レビュー概要</h4>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="総レビュー数" value={formatNumber(data.totalReviews)} />
            <Stat label="Steam購入" value={formatNumber(data.steamPurchaseReviews)} />
            <Stat label="ポジティブ" value={formatNumber(data.positiveReviews)} color="text-green-600" />
            <Stat label="ネガティブ" value={formatNumber(data.negativeReviews)} color="text-red-600" />
          </div>
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">好評率:</span>
              <div className="h-4 flex-1 overflow-hidden rounded-full bg-gray-200">
                <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${data.positiveRate}%` }} />
              </div>
              <span className="text-sm font-medium text-gray-800">{data.positiveRate.toFixed(1)}%</span>
            </div>
          </div>
        </div>

        <div>
          <h4 className="mb-2 font-semibold text-gray-800">仮説販売本数・売上</h4>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-1 text-left text-gray-600">ケース</th>
                <th className="py-1 text-right text-gray-600">販売本数</th>
                <th className="py-1 text-right text-gray-600">売上</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="py-1 text-gray-700">保守</td>
                <td className="text-right text-gray-800">{formatNumber(data.salesEstimate.conservative)}</td>
                <td className="text-right text-gray-800">{fp(revenueEstimate.conservative)}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-1 font-medium text-gray-700">標準</td>
                <td className="text-right font-medium text-gray-800">{formatNumber(data.salesEstimate.standard)}</td>
                <td className="text-right font-medium text-gray-800">{fp(revenueEstimate.standard)}</td>
              </tr>
              <tr>
                <td className="py-1 text-gray-700">強気</td>
                <td className="text-right text-gray-800">{formatNumber(data.salesEstimate.aggressive)}</td>
                <td className="text-right text-gray-800">{fp(revenueEstimate.aggressive)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <LanguageChart stats={data.languageStats} />

        {data.languageStats.length > 0 && (
          <div>
            <h4 className="mb-2 font-semibold text-gray-800">言語別レビュー数</h4>
            <div className="max-h-48 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="py-1 text-left text-gray-600">言語</th>
                    <th className="py-1 text-right text-gray-600">件数</th>
                    <th className="py-1 text-right text-gray-600">+</th>
                    <th className="py-1 text-right text-gray-600">-</th>
                  </tr>
                </thead>
                <tbody>
                  {data.languageStats.slice(0, 20).map((lang) => (
                    <tr key={lang.language} className="border-b border-gray-50">
                      <td className="py-1 text-gray-700">{lang.displayName ?? lang.language}</td>
                      <td className="text-right text-gray-800">{formatNumber(lang.count)}</td>
                      <td className="text-right text-green-600">{formatNumber(lang.positive)}</td>
                      <td className="text-right text-red-600">{formatNumber(lang.negative)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <ReviewTools data={data} />
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg bg-gray-50 p-3 text-center">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-lg font-bold ${color || "text-gray-800"}`}>{value}</p>
    </div>
  );
}
