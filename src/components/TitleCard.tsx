"use client";

import { useRef, useState } from "react";
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

function formatRecentSalesNote(data: GameAnalysis): string {
  const estimate = data.recentSalesEstimate;
  if (!estimate) return "直近レビュー取得に失敗";

  const reviewText = `直近${estimate.days}日のSteam購入レビューを最大1,500件まで取得`;
  if (estimate.isReviewCountCapped) {
    return `${reviewText}。今回は上限到達のため下限推定`;
  }
  return `${reviewText}。取得数: ${formatNumber(estimate.steamPurchaseReviewCount)}件`;
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
                    help="Steam購入レビュー数とレビュー倍率から推定した、Steamストア上で販売された本数です。括弧内は保守・強気の推定レンジです。キー配布やバンドル由来の所有者は別枠として扱います。"
                  />
                  <StatItem
                    label="Gross revenue (base game)"
                    value={formatCurrencyRange(grossRevenue, fp)}
                    note="ベースゲーム売上、Steam手数料控除前"
                    help="推定Steam販売本数にベースゲーム定価と有効販売価格係数を掛けた売上です。セールや地域価格の影響を考慮するため、標準ケースでは定価の60%で計算しています。"
                  />
                  <StatItem
                    label="Owners"
                    value={formatEstimateRangeFromCases(
                      data.marketEstimate.standard.ownersEstimate,
                      data.marketEstimate.conservative.ownersEstimate,
                      data.marketEstimate.aggressive.ownersEstimate,
                    )}
                    note="レビュー倍率法による推定所有者"
                    help="総レビュー数に、発売年・価格帯・好評率・平均プレイ時間で補正したレビュー倍率を掛けた推定所有者数です。実プレイ人数の公開データはないため、プレイヤー総数の近似としても扱います。厳密なユニークプレイヤー数ではありません。"
                  />
                  <StatItem
                    label="Average playtime"
                    value={averagePlaytimeHours == null ? "取得不可" : `${averagePlaytimeHours.toFixed(1)}h`}
                    note="レビュー投稿者サンプルから算出"
                    help="SteamレビューAPIから取得したレビュー投稿者サンプルの総プレイ時間平均です。全ユーザー平均ではありませんが、レビュー倍率補正の参考値として使います。"
                  />
                  <StatItem
                    label="Copies sold in the last 7 days"
                    value={
                      data.recentSalesEstimate
                        ? `${data.recentSalesEstimate.isReviewCountCapped ? ">= " : ""}${formatEstimateRange(
                            data.recentSalesEstimate.copiesSoldEstimate,
                          )}`
                        : "未取得"
                    }
                    note={formatRecentSalesNote(data)}
                    help="直近7日のSteam購入レビュー数に、通常のレビュー倍率を掛けて直近販売本数を推定します。人気タイトルでは取得時間を抑えるためレビュー取得を1,500件で打ち切り、上限到達時は>=付きの下限推定として表示します。"
                  />
                </div>

                <div className="mt-5 rounded-lg bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold text-slate-800">Players by country</p>
                      <HelpTooltip text="Steamから国別プレイヤーの実測値は取得できないため、レビュー言語を国・地域の簡易プロキシとして表示しています。USは英語、CNは簡体字/繁体字中国語、RUはロシア語レビューを近似として扱います。" />
                    </div>
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

function StatItem({
  label,
  value,
  note,
  help,
  muted,
}: {
  label: string;
  value: string;
  note: string;
  help?: string;
  muted?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-3 ${muted ? "border-slate-100 bg-slate-50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        {help && <HelpTooltip text={help} />}
      </div>
      <p className={`mt-1 text-lg font-bold ${muted ? "text-slate-500" : "text-slate-900"}`}>{value}</p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{note}</p>
    </div>
  );
}

function HelpTooltip({ text }: { text: string }) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  function showTooltip() {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const tooltipWidth = Math.min(288, window.innerWidth - 24);
    const left = Math.min(Math.max(rect.left + rect.width / 2 - tooltipWidth / 2, 12), window.innerWidth - tooltipWidth - 12);
    const top = Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - 160));
    setPosition({ left, top });
  }

  return (
    <span className="relative inline-flex" onMouseLeave={() => setPosition(null)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label="説明を表示"
        onFocus={showTooltip}
        onBlur={() => setPosition(null)}
        onMouseEnter={showTooltip}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-slate-300 bg-white text-[10px] font-bold leading-none text-slate-500 hover:border-blue-300 hover:text-blue-700 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
      >
        ?
      </button>
      {position && (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-50 w-72 max-w-[calc(100vw-1.5rem)] rounded-md border border-slate-200 bg-white p-3 text-xs font-normal leading-5 text-slate-700 shadow-lg"
          style={{ left: position.left, top: position.top }}
        >
          {text}
        </span>
      )}
    </span>
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
