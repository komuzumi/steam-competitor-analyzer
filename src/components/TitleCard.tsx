"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { GameAnalysis, LanguageStat, SalesEstimate } from "@/types";
import { CurrencyCode, formatPrice } from "@/lib/currency";
import { estimateNetRevenue, estimateRevenue } from "@/lib/sales";
import LanguageChart from "@/components/LanguageChart";
import ReviewTools from "@/components/ReviewTools";

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("ja-JP");
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatShortNumber(n: number): string {
  const rounded = Math.round(n);
  const abs = Math.abs(rounded);
  if (abs >= 1_000_000_000) return `${(rounded / 1_000_000_000).toFixed(1)}b`;
  if (abs >= 1_000_000) return `${(rounded / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${(rounded / 1_000).toFixed(1)}k`;
  return rounded.toLocaleString("ja-JP");
}

function formatEstimateRange(values: SalesEstimate): string {
  return formatEstimateRangeFromCases(values.standard, values.conservative, values.aggressive);
}

function formatEstimateRangeFromCases(standard: number, conservative: number, aggressive: number): string {
  return `${formatShortNumber(standard)} (${formatShortNumber(conservative)} - ${formatShortNumber(aggressive)})`;
}

function formatCurrencyRange(values: SalesEstimate, formatCurrency: (value: number) => string): string {
  return `${formatCurrency(values.standard)} (${formatCurrency(values.conservative)} - ${formatCurrency(values.aggressive)})`;
}

function getCountryProxyStats(stats: LanguageStat[]): { label: string; percent: number }[] {
  const total = stats.reduce((sum, stat) => sum + stat.count, 0);
  if (total <= 0) {
    return [
      { label: "US", percent: 0 },
      { label: "CN", percent: 0 },
      { label: "RU", percent: 0 },
      { label: "others", percent: 0 },
    ];
  }

  const countByLanguage = new Map(stats.map((stat) => [stat.language, stat.count]));
  const usProxy = countByLanguage.get("english") ?? 0;
  const cnProxy = (countByLanguage.get("schinese") ?? 0) + (countByLanguage.get("tchinese") ?? 0);
  const ruProxy = countByLanguage.get("russian") ?? 0;
  const others = Math.max(total - usProxy - cnProxy - ruProxy, 0);

  return [
    { label: "US", percent: (usProxy / total) * 100 },
    { label: "CN", percent: (cnProxy / total) * 100 },
    { label: "RU", percent: (ruProxy / total) * 100 },
    { label: "others", percent: (others / total) * 100 },
  ];
}

function formatAverageDailyConcurrentPlayers(data: GameAnalysis): string {
  const history = data.concurrentPlayersHistory;
  if (history?.averageDailyPlayers != null) return formatShortNumber(history.averageDailyPlayers);
  if (data.currentPlayers != null) return `履歴不足（現在 ${formatShortNumber(data.currentPlayers)}）`;
  return "履歴不足";
}

function formatAverageDailyConcurrentPlayersNote(data: GameAnalysis): string {
  const history = data.concurrentPlayersHistory;
  if (!history) return "Supabase未設定、または履歴未取得";
  if (!history.sampleCount) return `直近${history.periodDays}日の同接スナップショットが未蓄積`;
  const base = `直近${history.periodDays}日: ${history.capturedDays}日分 / ${history.sampleCount}サンプル`;
  return history.hasEnoughHistory ? `${base}から算出` : `${base}。30日分で精度向上`;
}

interface Props {
  data: GameAnalysis;
  currency: CurrencyCode;
}

type Tab = "overview" | "estimate" | "reviews" | "ai";

export default function TitleCard({ data, currency }: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const priceInfo = data.prices[currency];
  const fp = (n: number) => formatPrice(n, currency);
  const grossRevenue = estimateRevenue(data.salesEstimate, priceInfo?.basePrice ?? 0);
  const netRevenue = estimateNetRevenue(grossRevenue);
  const standard = data.marketEstimate.standard;
  const averagePlaytimeHours = data.marketEstimate.explanation.averagePlaytimeHours;
  const countryProxyStats = getCountryProxyStats(data.languageStats);

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="grid gap-0 lg:grid-cols-[360px_1fr]">
        <div className="relative min-h-[220px] bg-slate-900">
          {data.headerImage && <img src={data.headerImage} alt={data.name} className="h-full w-full object-cover" />}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-5">
            <h2 className="text-2xl font-bold text-white">{data.name}</h2>
            <p className="mt-1 text-sm text-slate-200">
              AppID: {data.appId} / {data.releaseDate}
            </p>
          </div>
        </div>

        <div className="p-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="推定所有者" value={formatNumber(standard.ownersEstimate)} />
            <Metric label="推定Steam販売本数" value={formatNumber(standard.steamCopiesSoldEstimate)} />
            <Metric label="総売上(標準)" value={fp(grossRevenue.standard)} />
            <Metric label="手数料控除後(標準)" value={fp(netRevenue.standard)} />
            <Metric label="レビュー数" value={formatNumber(data.totalReviews)} />
            <Metric label="好評率" value={formatPercent(data.positiveRate)} color="text-green-600" />
            <Metric label="現在同時接続者" value={data.currentPlayers == null ? "取得不可" : formatNumber(data.currentPlayers)} />
            <Metric label="推定信頼度" value={data.marketEstimate.confidence} color={confidenceColor(data.marketEstimate.confidence)} />
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200">
        <div className="flex overflow-x-auto bg-slate-50 px-4">
          {[
            ["overview", "概要"],
            ["estimate", "売上推定"],
            ["reviews", "レビュー/言語"],
            ["ai", "AI/CSV"],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key as Tab)}
              className={`border-b-2 px-4 py-3 text-sm font-medium ${
                tab === key
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-600 hover:text-slate-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-5">
          {tab === "overview" && (
            <div className="space-y-5">
              <Panel title="Stats">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <StatItem
                    label="Copies sold"
                    value={formatEstimateRange(data.salesEstimate)}
                    note="Steam直接販売本数の推定"
                  />
                  <StatItem
                    label="Gross revenue (base game)"
                    value={formatCurrencyRange(grossRevenue, fp)}
                    note="ベースゲーム売上、Steam手数料控除前"
                  />
                  <StatItem
                    label="Gross revenue total (experimental)"
                    value="未対応"
                    note="DLC/IAP/バンドル売上の安定取得元が必要"
                    muted
                  />
                  <StatItem
                    label="Outstanding wishlists"
                    value="未取得"
                    note="Steam公開APIでは取得不可"
                    muted
                  />
                  <StatItem
                    label="Players total"
                    value={formatEstimateRangeFromCases(
                      data.marketEstimate.standard.ownersEstimate,
                      data.marketEstimate.conservative.ownersEstimate,
                      data.marketEstimate.aggressive.ownersEstimate,
                    )}
                    note="所有者推定をプレイヤー総数の近似として表示"
                  />
                  <StatItem
                    label="Owners"
                    value={formatEstimateRangeFromCases(
                      data.marketEstimate.standard.ownersEstimate,
                      data.marketEstimate.conservative.ownersEstimate,
                      data.marketEstimate.aggressive.ownersEstimate,
                    )}
                    note="レビュー倍率法による推定所有者"
                  />
                  <StatItem label="Reviews" value={formatShortNumber(data.totalReviews)} note="Steam公開レビュー数" />
                  <StatItem label="Review score" value={formatPercent(data.positiveRate)} note="好評レビュー比率" />
                  <StatItem
                    label="Average playtime"
                    value={averagePlaytimeHours == null ? "取得不可" : `${averagePlaytimeHours.toFixed(1)}h`}
                    note="レビュー投稿者サンプルから算出"
                  />
                  <StatItem
                    label="Average daily concurrent players"
                    value={formatAverageDailyConcurrentPlayers(data)}
                    note={formatAverageDailyConcurrentPlayersNote(data)}
                    muted={!data.concurrentPlayersHistory?.hasEnoughHistory}
                  />
                  <StatItem label="Followers" value="未取得" note="SteamDB等の外部独自データは使わない" muted />
                  <StatItem
                    label="Copies sold in the last 7 days"
                    value={
                      data.recentSalesEstimate
                        ? `${data.recentSalesEstimate.isReviewCountCapped ? ">= " : ""}${formatEstimateRange(
                            data.recentSalesEstimate.copiesSoldEstimate,
                          )}`
                        : "未取得"
                    }
                    note={
                      data.recentSalesEstimate
                        ? `直近${data.recentSalesEstimate.days}日のSteam購入レビュー${formatNumber(
                            data.recentSalesEstimate.steamPurchaseReviewCount,
                          )}${data.recentSalesEstimate.isReviewCountCapped ? "件以上" : "件"}から推定`
                        : "直近レビュー取得に失敗"
                    }
                  />
                </div>

                <div className="mt-5 rounded-lg bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-800">Players by country</p>
                    <p className="text-xs text-slate-500">レビュー言語ベースの簡易プロキシ</p>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-4">
                    {countryProxyStats.map((country) => (
                      <div key={country.label}>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-700">{country.label}</span>
                          <span className="text-slate-600">~ {formatPercent(country.percent)}</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                          <div className="h-full rounded-full bg-blue-500" style={{ width: `${country.percent}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    国別の実測ではありません。USは英語レビュー、CNは中国語レビュー、RUはロシア語レビューを近似として使っています。
                  </p>
                </div>
              </Panel>

              <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
                <Panel title="価格・エディション">
                  {data.editions.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-slate-200">
                            <th className="px-2 py-2 text-left text-slate-600">エディション</th>
                            <th className="px-2 py-2 text-right text-slate-600">定価</th>
                            <th className="px-2 py-2 text-right text-slate-600">現在価格</th>
                            <th className="px-2 py-2 text-right text-slate-600">過去最安</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.editions.map((edition) => {
                            const ep = edition.prices[currency];
                            if (!ep) return null;
                            return (
                              <tr
                                key={edition.packageId}
                                className={`border-b border-slate-100 ${edition.isStandard ? "bg-blue-50" : ""}`}
                              >
                                <td className="px-2 py-2 font-medium text-slate-700">{edition.displayName}</td>
                                <td className="px-2 py-2 text-right text-slate-800">{fp(ep.basePrice)}</td>
                                <td className="px-2 py-2 text-right text-slate-800">
                                  {fp(ep.currentPrice)}
                                  {ep.discountPercent > 0 && <span className="ml-1 text-xs text-green-600">-{ep.discountPercent}%</span>}
                                </td>
                                <td className="px-2 py-2 text-right text-slate-800">
                                  {ep.historicalLow !== null ? fp(ep.historicalLow) : "-"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">価格情報を取得できませんでした。</p>
                  )}
                </Panel>

                <Panel title="レビュー概要">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Metric label="総レビュー" value={formatNumber(data.totalReviews)} />
                    <Metric label="Steam購入レビュー" value={formatNumber(data.steamPurchaseReviews)} />
                    <Metric label="好評" value={formatNumber(data.positiveReviews)} color="text-green-600" />
                    <Metric label="不評" value={formatNumber(data.negativeReviews)} color="text-red-600" />
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <span className="text-sm text-slate-600">好評率</span>
                    <div className="h-4 flex-1 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-green-500" style={{ width: `${data.positiveRate}%` }} />
                    </div>
                    <span className="text-sm font-medium text-slate-800">{formatPercent(data.positiveRate)}</span>
                  </div>
                </Panel>
              </div>
            </div>
          )}

          {tab === "estimate" && (
            <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
              <Panel title="推定販売本数・売上">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200">
                        <th className="py-2 text-left text-slate-600">ケース</th>
                        <th className="py-2 text-right text-slate-600">推定所有者</th>
                        <th className="py-2 text-right text-slate-600">Steam販売本数</th>
                        <th className="py-2 text-right text-slate-600">総売上</th>
                        <th className="py-2 text-right text-slate-600">手数料控除後</th>
                      </tr>
                    </thead>
                    <tbody>
                      <EstimateRow
                        label="保守"
                        owners={data.marketEstimate.conservative.ownersEstimate}
                        copies={data.salesEstimate.conservative}
                        gross={grossRevenue.conservative}
                        net={netRevenue.conservative}
                        fp={fp}
                      />
                      <EstimateRow
                        label="標準"
                        owners={data.marketEstimate.standard.ownersEstimate}
                        copies={data.salesEstimate.standard}
                        gross={grossRevenue.standard}
                        net={netRevenue.standard}
                        fp={fp}
                        highlight
                      />
                      <EstimateRow
                        label="強気"
                        owners={data.marketEstimate.aggressive.ownersEstimate}
                        copies={data.salesEstimate.aggressive}
                        gross={grossRevenue.aggressive}
                        net={netRevenue.aggressive}
                        fp={fp}
                      />
                    </tbody>
                  </table>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  総売上はSteam手数料控除前、手数料控除後は総売上の70%として表示しています。
                </p>
              </Panel>

              <Panel title="推定ロジック">
                <div className="space-y-3 text-sm text-slate-700">
                  <LogicRow label="基準レビュー倍率" value={`${data.marketEstimate.explanation.baseReviewMultiplier} (${data.marketEstimate.explanation.ageFactorLabel})`} />
                  <LogicRow label="価格補正" value={`x ${data.marketEstimate.explanation.priceFactor}`} />
                  <LogicRow label="好評率補正" value={`x ${data.marketEstimate.explanation.reviewScoreFactor}`} />
                  <LogicRow label="プレイ時間補正" value={`x ${data.marketEstimate.explanation.playtimeFactor}`} />
                  <LogicRow label="最終レビュー倍率" value={data.marketEstimate.explanation.adjustedReviewMultiplier.toFixed(1)} />
                  <LogicRow
                    label="Steam購入レビュー比率"
                    value={`${(data.marketEstimate.explanation.steamPurchaseReviewShare * 100).toFixed(1)}%`}
                  />
                  <LogicRow label="信頼度" value={data.marketEstimate.confidence} />
                </div>
                <div className="mt-4 rounded-lg bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-700">使用データ</p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{data.marketEstimate.explanation.usedData.join(" / ")}</p>
                  <p className="mt-3 text-xs font-semibold text-slate-700">予約中の推定手法</p>
                  <ul className="mt-1 space-y-1 text-xs leading-5 text-slate-600">
                    {data.marketEstimate.methods
                      .filter((method) => method.weight === 0)
                      .map((method) => (
                        <li key={method.id}>{method.label}: {method.note}</li>
                      ))}
                  </ul>
                </div>
              </Panel>
            </div>
          )}

          {tab === "reviews" && (
            <div className="space-y-5">
              <LanguageChart stats={data.languageStats} />
              {data.languageStats.length > 0 && (
                <Panel title="言語別レビュー詳細">
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="py-1 text-left text-slate-600">言語</th>
                          <th className="py-1 text-right text-slate-600">件数</th>
                          <th className="py-1 text-right text-slate-600">好評</th>
                          <th className="py-1 text-right text-slate-600">不評</th>
                          <th className="py-1 text-right text-slate-600">好評率</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.languageStats.slice(0, 30).map((lang) => {
                          const rate = lang.count > 0 ? (lang.positive / lang.count) * 100 : 0;
                          return (
                            <tr key={lang.language} className="border-b border-slate-50">
                              <td className="py-1 text-slate-700">{lang.displayName ?? lang.language}</td>
                              <td className="text-right text-slate-800">{formatNumber(lang.count)}</td>
                              <td className="text-right text-green-600">{formatNumber(lang.positive)}</td>
                              <td className="text-right text-red-600">{formatNumber(lang.negative)}</td>
                              <td className="text-right text-slate-800">{formatPercent(rate)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Panel>
              )}
            </div>
          )}

          {tab === "ai" && <ReviewTools data={data} />}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${color || "text-slate-900"}`}>{value}</p>
    </div>
  );
}

function StatItem({ label, value, note, muted }: { label: string; value: string; note: string; muted?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${muted ? "border-slate-100 bg-slate-50" : "border-slate-200 bg-white"}`}>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold ${muted ? "text-slate-500" : "text-slate-900"}`}>{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{note}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-3 font-semibold text-slate-900">{title}</h3>
      {children}
    </div>
  );
}

function EstimateRow({
  label,
  owners,
  copies,
  gross,
  net,
  fp,
  highlight,
}: {
  label: string;
  owners: number;
  copies: number;
  gross: number;
  net: number;
  fp: (value: number) => string;
  highlight?: boolean;
}) {
  return (
    <tr className={`border-b border-slate-100 ${highlight ? "bg-blue-50" : ""}`}>
      <td className="py-2 font-medium text-slate-700">{label}</td>
      <td className="py-2 text-right text-slate-800">{formatNumber(owners)}</td>
      <td className="py-2 text-right text-slate-800">{formatNumber(copies)}</td>
      <td className="py-2 text-right text-slate-800">{fp(gross)}</td>
      <td className="py-2 text-right font-medium text-slate-900">{fp(net)}</td>
    </tr>
  );
}

function LogicRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 pb-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-900">{value}</span>
    </div>
  );
}

function confidenceColor(confidence: string): string {
  if (confidence === "High") return "text-green-600";
  if (confidence === "Medium") return "text-amber-600";
  return "text-red-600";
}
