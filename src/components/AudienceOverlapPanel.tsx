"use client";

import { useMemo, useState } from "react";
import { AudienceOverlapGame, AudienceOverlapResponse } from "@/types";
import { CurrencyCode, formatPrice } from "@/lib/currency";

interface Props {
  appId: string;
  currency: CurrencyCode;
}

function formatShortNumber(n: number): string {
  const rounded = Math.round(n);
  const abs = Math.abs(rounded);
  if (abs >= 1_000_000_000) return `${(rounded / 1_000_000_000).toFixed(1)}b`;
  if (abs >= 1_000_000) return `${(rounded / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${(rounded / 1_000).toFixed(1)}k`;
  return rounded.toLocaleString("ja-JP");
}

function formatPercent(value: number): string {
  return `${value.toFixed(value >= 10 ? 1 : 2)}%`;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function makeCsv(rows: AudienceOverlapGame[]): string {
  const headers = [
    "app_id",
    "name",
    "hybrid_score",
    "reviewer_overlap_percent",
    "shared_reviewers",
    "target_reviewer_sample",
    "candidate_reviewer_sample",
    "tag_similarity",
    "genre_similarity",
    "category_similarity",
    "release_date",
    "price",
    "estimated_copies_sold",
    "estimated_gross_revenue",
    "genres",
    "tags",
    "reasons",
  ];
  const body = rows.map((row) =>
    [
      row.appId,
      row.name,
      row.hybridScore,
      row.reviewOverlapPercent,
      row.sharedReviewers,
      row.targetReviewerSampleSize,
      row.candidateReviewerSampleSize,
      row.tagSimilarity,
      row.genreSimilarity,
      row.categorySimilarity,
      row.releaseDate,
      row.price,
      row.estimatedCopiesSold,
      row.estimatedGrossRevenue,
      row.genres.join(" / "),
      row.tags.join(" / "),
      row.reasons.join(" / "),
    ]
      .map(csvCell)
      .join(","),
  );
  return `\uFEFF${headers.join(",")}\n${body.join("\n")}`;
}

export default function AudienceOverlapPanel({ appId, currency }: Props) {
  const currentKey = `${appId}:${currency}`;
  const [dataState, setDataState] = useState<{ key: string; value: AudienceOverlapResponse } | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorState, setErrorState] = useState<{ key: string; message: string } | null>(null);
  const data = dataState?.key === currentKey ? dataState.value : null;
  const error = errorState?.key === currentKey ? errorState.message : null;

  const allRows = useMemo(() => {
    if (!data) return [];
    const byAppId = new Map<string, AudienceOverlapGame>();
    for (const row of [...data.alsoPlayed, ...data.reviewerOverlap, ...data.surprisingOverlap]) {
      byAppId.set(row.appId, row);
    }
    return Array.from(byAppId.values()).sort((a, b) => b.hybridScore - a.hybridScore);
  }, [data]);

  async function loadOverlap() {
    setLoading(true);
    setErrorState(null);
    try {
      const res = await fetch(`/api/audience-overlap?appId=${encodeURIComponent(appId)}&currency=${currency}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "類似タイトル分析に失敗しました。");
      setDataState({ key: currentKey, value: json });
    } catch (err) {
      setErrorState({
        key: currentKey,
        message: err instanceof Error ? err.message : "類似タイトル分析に失敗しました。",
      });
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv() {
    if (!allRows.length) return;
    const blob = new Blob([makeCsv(allRows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audience-overlap-${appId}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-blue-100 bg-blue-50 p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h3 className="font-semibold text-slate-900">類似プレイヤー層分析</h3>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              Steam上の関連候補、同じ人が両方のゲームにレビューしている割合、タグ/ジャンル/カテゴリの近さを組み合わせて、
              競合・参考タイトルを探します。実プレイヤー全体の重複率ではなく、公開データだけで作る推定です。
            </p>
            {data && (
              <p className="mt-2 text-xs text-slate-600">
                対象レビュー投稿者サンプル: {data.target.reviewerSampleSize.toLocaleString("ja-JP")}人 / 対象タグ:{" "}
                {data.target.tags.slice(0, 8).join(" / ") || "取得なし"}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={loadOverlap}
              disabled={loading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "分析中..." : data ? "再分析" : "類似タイトルを取得"}
            </button>
            <button
              type="button"
              onClick={downloadCsv}
              disabled={!allRows.length}
              className="rounded-lg border border-blue-200 bg-white px-4 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              CSV出力
            </button>
          </div>
        </div>
      </div>

      {error && <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {loading && (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
          類似候補のメタ情報、タグ、レビュー投稿者サンプルを取得しています。大型タイトルでは少し時間がかかります。
        </div>
      )}

      {data && (
        <div className="grid gap-5 xl:grid-cols-2">
          <OverlapTable
            title="このゲームのプレイヤーが遊んでいそうなタイトル"
            description="同じ人が両方にレビューしている割合と、タグ/ジャンルの近さを合成した総合スコア順です。"
            rows={data.alsoPlayed}
            scoreLabel="総合スコア"
            scoreAccessor={(row) => row.hybridScore}
            scoreFormatter={(value) => value.toFixed(1)}
            currency={currency}
          />
          <OverlapTable
            title="同じレビュー投稿者が多いタイトル"
            description="対象ゲームにレビューした人のうち、候補ゲームにもレビューしている人の割合順です。ジャンルが近いとは限らないため、実ユーザーの関心の近さを見る補助指標です。"
            rows={data.reviewerOverlap}
            scoreLabel="投稿者一致"
            scoreAccessor={(row) => row.reviewOverlapPercent}
            currency={currency}
          />
          <OverlapTable
            title="意外な関連候補"
            description="同じレビュー投稿者がいる一方で、タグの類似度が低いタイトルです。競合ではなく、ユーザーの別ジャンル関心や企画のヒントを探すための表です。"
            rows={data.surprisingOverlap}
            scoreLabel="投稿者一致"
            scoreAccessor={(row) => row.reviewOverlapPercent}
            currency={currency}
            className="xl:col-span-2"
          />
        </div>
      )}
    </div>
  );
}

function OverlapTable({
  title,
  description,
  rows,
  scoreLabel,
  scoreAccessor,
  scoreFormatter = formatPercent,
  currency,
  className = "",
}: {
  title: string;
  description: string;
  rows: AudienceOverlapGame[];
  scoreLabel: string;
  scoreAccessor: (row: AudienceOverlapGame) => number;
  scoreFormatter?: (value: number) => string;
  currency: CurrencyCode;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-xl border border-slate-200 bg-white ${className}`}>
      <div className="border-b border-slate-200 p-4">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              <th className="px-3 py-3 text-left font-medium">ゲーム</th>
              <th className="px-3 py-3 text-right font-medium">{scoreLabel}</th>
              <th className="px-3 py-3 text-right font-medium">タグ類似</th>
              <th className="px-3 py-3 text-right font-medium">発売日</th>
              <th className="px-3 py-3 text-right font-medium">価格</th>
              <th className="px-3 py-3 text-right font-medium">推定販売本数</th>
              <th className="px-3 py-3 text-right font-medium">推定売上</th>
              <th className="px-3 py-3 text-left font-medium">ジャンル</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.appId} className="border-b border-slate-100 align-top hover:bg-slate-50">
                <td className="px-3 py-3">
                  <div className="flex items-center gap-3">
                    <a
                      href={`https://store.steampowered.com/app/${row.appId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="h-12 w-24 shrink-0 rounded bg-slate-200 bg-cover bg-center"
                      style={{ backgroundImage: row.headerImage ? `url(${row.headerImage})` : undefined }}
                      aria-label={`${row.name}をSteamで開く`}
                    />
                    <div className="min-w-0">
                      <a
                        href={`https://store.steampowered.com/app/${row.appId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {row.name}
                      </a>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-500">{row.reasons.join(" / ")}</p>
                      <p className="mt-1 text-[11px] text-slate-400">
                        共通投稿者 {row.sharedReviewers.toLocaleString("ja-JP")}人 / サンプル{" "}
                        {row.targetReviewerSampleSize.toLocaleString("ja-JP")}人 x{" "}
                        {row.candidateReviewerSampleSize.toLocaleString("ja-JP")}人
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3 text-right">
                  <ScorePill value={scoreAccessor(row)} formatter={scoreFormatter} />
                </td>
                <td className="px-3 py-3 text-right text-slate-700">{formatPercent(row.tagSimilarity)}</td>
                <td className="px-3 py-3 text-right text-slate-700">{row.releaseDate}</td>
                <td className="px-3 py-3 text-right text-slate-700">{formatPrice(row.price, currency)}</td>
                <td className="px-3 py-3 text-right text-slate-700">{formatShortNumber(row.estimatedCopiesSold)}</td>
                <td className="px-3 py-3 text-right text-slate-700">
                  {formatPrice(row.estimatedGrossRevenue, currency)}
                </td>
                <td className="px-3 py-3 text-slate-600">{row.genres.slice(0, 3).join(" / ") || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="p-4 text-sm text-slate-500">候補を取得できませんでした。</p>}
    </section>
  );
}

function ScorePill({ value, formatter }: { value: number; formatter: (value: number) => string }) {
  return (
    <div className="inline-flex min-w-24 flex-col items-end gap-1">
      <span className="font-semibold text-slate-900">{formatter(value)}</span>
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-200">
        <span className="block h-full rounded-full bg-blue-500" style={{ width: `${Math.min(value, 100)}%` }} />
      </span>
    </div>
  );
}
