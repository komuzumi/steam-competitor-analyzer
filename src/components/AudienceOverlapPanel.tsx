"use client";

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { AudienceClassification, AudienceOverlapGame, AudienceOverlapResponse } from "@/types";
import { CurrencyCode, formatPrice } from "@/lib/currency";

interface Props {
  appId: string;
  currency: CurrencyCode;
}

type ClassificationFilter = "all" | Exclude<AudienceClassification, "target">;

const CLASSIFICATION_LABELS: Record<ClassificationFilter, string> = {
  all: "すべて",
  direct_competitor: "直接競合",
  adjacent_genre: "近接ジャンル",
  surprising_link: "意外な関連",
  fanbase_neighbor: "ファン層近接",
};

const CLASSIFICATION_COLORS: Record<AudienceClassification, string> = {
  target: "#111827",
  direct_competitor: "#2563eb",
  adjacent_genre: "#0f766e",
  surprising_link: "#d97706",
  fanbase_neighbor: "#7c3aed",
};

const CLASSIFICATION_DESCRIPTIONS: Record<Exclude<AudienceClassification, "target">, string> = {
  direct_competitor: "タグとジャンルが近く、同じ棚で比較されやすい候補です。",
  adjacent_genre: "タグやカテゴリが部分的に近く、比較対象に入りやすい候補です。",
  surprising_link: "タグは離れていますが、同じ投稿者がレビューしている候補です。",
  fanbase_neighbor: "同じ投稿者の重なりがあり、ユーザー関心が近い可能性があります。",
};

const CLASSIFICATION_ORDER: Exclude<AudienceClassification, "target">[] = [
  "direct_competitor",
  "adjacent_genre",
  "surprising_link",
  "fanbase_neighbor",
];

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

function formatReviewerOverlap(row: AudienceOverlapGame): string {
  if (row.classification === "target") return "対象";
  return `${row.sharedReviewers.toLocaleString("ja-JP")} / ${row.targetReviewerSampleSize.toLocaleString("ja-JP")} (${formatPercent(row.reviewOverlapPercent)})`;
}

function formatNullableNumber(value: number | null): string {
  return value == null ? "-" : value.toLocaleString("ja-JP");
}

function formatPlaytime(value: number | null): string {
  return value == null ? "-" : `${value.toFixed(1)}h`;
}

function csvCell(value: string | number | null | undefined): string {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function makeCsv(rows: AudienceOverlapGame[]): string {
  const headers = [
    "app_id",
    "name",
    "classification",
    "classification_reason",
    "hybrid_score",
    "reviewer_overlap_percent",
    "shared_reviewers",
    "tag_similarity",
    "genre_similarity",
    "release_date",
    "price",
    "total_reviews",
    "positive_rate",
    "estimated_copies_sold",
    "estimated_gross_revenue",
    "current_players",
    "momentum_score",
    "momentum_label",
    "recent_7d_reviews",
    "average_playtime_hours",
    "genres",
    "tags",
    "estimate_diagnostics",
  ];
  const body = rows.map((row) =>
    [
      row.appId,
      row.name,
      row.classificationLabel,
      row.classificationReason,
      row.hybridScore,
      row.reviewOverlapPercent,
      row.sharedReviewers,
      row.tagSimilarity,
      row.genreSimilarity,
      row.releaseDate,
      row.price,
      row.totalReviews,
      row.positiveRate,
      row.estimatedCopiesSold,
      row.estimatedGrossRevenue,
      row.currentPlayers,
      row.momentumScore,
      row.momentumLabel,
      `${row.recentReviewActivity7d.isCapped ? ">= " : ""}${row.recentReviewActivity7d.reviewCount}`,
      row.averagePlaytimeHours,
      row.genres.join(" / "),
      row.tags.join(" / "),
      row.estimateDiagnostics.join(" / "),
    ]
      .map(csvCell)
      .join(","),
  );
  return `\uFEFF${headers.join(",")}\n${body.join("\n")}`;
}

export default function AudienceOverlapPanel({ appId, currency }: Props) {
  const currentKey = `${appId}:${currency}`;
  const [dataState, setDataState] = useState<{ key: string; value: AudienceOverlapResponse } | null>(null);
  const [classificationFilter, setClassificationFilter] = useState<ClassificationFilter>("all");
  const [loading, setLoading] = useState(false);
  const [errorState, setErrorState] = useState<{ key: string; message: string } | null>(null);
  const data = dataState?.key === currentKey ? dataState.value : null;
  const error = errorState?.key === currentKey ? errorState.message : null;

  const competitorRows = useMemo(() => {
    if (!data) return [];
    const byAppId = new Map<string, AudienceOverlapGame>();
    for (const row of [...data.competitors, ...data.alsoPlayed, ...data.reviewerOverlap, ...data.surprisingOverlap]) {
      byAppId.set(row.appId, row);
    }
    return Array.from(byAppId.values()).sort((a, b) => b.hybridScore - a.hybridScore);
  }, [data]);

  const filteredCompetitors = useMemo(() => {
    if (classificationFilter === "all") return competitorRows;
    return competitorRows.filter((row) => row.classification === classificationFilter);
  }, [classificationFilter, competitorRows]);

  const comparisonRows = useMemo(() => {
    if (!data) return [];
    return [data.targetGame, ...filteredCompetitors];
  }, [data, filteredCompetitors]);

  async function loadOverlap() {
    setLoading(true);
    setErrorState(null);
    try {
      const res = await fetch(`/api/audience-overlap?appId=${encodeURIComponent(appId)}&currency=${currency}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "競合分析に失敗しました。");
      setDataState({ key: currentKey, value: json });
    } catch (err) {
      setErrorState({
        key: currentKey,
        message: err instanceof Error ? err.message : "競合分析に失敗しました。",
      });
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv() {
    if (!comparisonRows.length) return;
    const blob = new Blob([makeCsv(comparisonRows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `competitive-insights-${appId}.csv`;
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
            <h3 className="font-semibold text-slate-900">競合分析</h3>
            <p className="mt-1 text-sm leading-6 text-slate-700">
              Steam上の関連候補、同じ人が両方のゲームにレビューしている割合、タグ/ジャンル/カテゴリ、直近レビューと同接を組み合わせて、
              競合・参考タイトルを分類します。実プレイヤー全体の重複率ではなく、公開データだけで作る推定です。
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
              {loading ? "分析中..." : data ? "再分析" : "競合候補を取得"}
            </button>
            <button
              type="button"
              onClick={downloadCsv}
              disabled={!comparisonRows.length}
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
          競合候補のメタ情報、タグ、レビュー投稿者サンプル、直近レビュー、同接を取得しています。大型タイトルでは少し時間がかかります。
        </div>
      )}

      {data && (
        <>
          <ClassificationSummary rows={competitorRows} />

          <div className="flex flex-wrap gap-2">
            {(Object.keys(CLASSIFICATION_LABELS) as ClassificationFilter[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setClassificationFilter(key)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                  classificationFilter === key
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {CLASSIFICATION_LABELS[key]}
              </button>
            ))}
          </div>

          <CompetitiveComparisonTable rows={comparisonRows} currency={currency} />
          <PositioningMap rows={comparisonRows} currency={currency} />

          <div className="grid gap-5 xl:grid-cols-2">
            <CandidateTable
              title="このゲームのプレイヤーが遊んでいそうなタイトル"
              description="同じ人が両方にレビューしている割合と、タグ/ジャンルの近さを合成した総合スコア順です。"
              rows={data.alsoPlayed}
              scoreLabel="総合スコア"
              scoreAccessor={(row) => row.hybridScore}
              scoreFormatter={(value) => value.toFixed(1)}
              currency={currency}
            />
            <CandidateTable
              title="同じレビュー投稿者が多いタイトル"
              description="対象ゲームにレビューした人のうち、候補ゲームにもレビューしている人の割合順です。ジャンルが近いとは限らないため、実ユーザーの関心の近さを見る補助指標です。"
              rows={data.reviewerOverlap}
              scoreLabel="投稿者一致"
              scoreAccessor={(row) => row.reviewOverlapPercent}
              currency={currency}
              showReviewerOverlapDetail
            />
            <CandidateTable
              title="意外な関連候補"
              description="同じレビュー投稿者がいる一方で、タグ類似が低め、または総合スコアでは上位に出にくいタイトルです。競合ではなく、ユーザーの別ジャンル関心や企画のヒントを探すための表です。"
              rows={data.surprisingOverlap}
              scoreLabel="投稿者一致"
              scoreAccessor={(row) => row.reviewOverlapPercent}
              currency={currency}
              className="xl:col-span-2"
              showReviewerOverlapDetail
            />
          </div>
        </>
      )}
    </div>
  );
}

function ClassificationSummary({ rows }: { rows: AudienceOverlapGame[] }) {
  const counts = rows.reduce(
    (acc, row) => {
      if (row.classification !== "target") acc[row.classification] = (acc[row.classification] ?? 0) + 1;
      return acc;
    },
    {} as Record<Exclude<AudienceClassification, "target">, number>,
  );
  const averageMomentum = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + row.momentumScore, 0) / rows.length)
    : 0;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      {(Object.keys(CLASSIFICATION_LABELS).filter((key) => key !== "all") as Exclude<
        AudienceClassification,
        "target"
      >[]).map((key) => (
        <div key={key} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: CLASSIFICATION_COLORS[key] }}
            />
            <p className="text-xs font-medium text-slate-500">{CLASSIFICATION_LABELS[key]}</p>
          </div>
          <p className="mt-1 text-xl font-bold text-slate-900">{counts[key] ?? 0}</p>
        </div>
      ))}
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-xs font-medium text-slate-500">平均勢いスコア</p>
        <p className="mt-1 text-xl font-bold text-slate-900">{averageMomentum}</p>
      </div>
    </div>
  );
}

function CompetitiveComparisonTable({ rows, currency }: { rows: AudienceOverlapGame[]; currency: CurrencyCode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <h3 className="font-semibold text-slate-900">競合比較テーブル</h3>
        <ClassificationDescription rows={rows} />
      </div>
      <div className="max-h-[560px] overflow-auto">
        <table className="w-full min-w-[1760px] text-sm">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              <th className="px-3 py-3 text-left font-medium">ゲーム</th>
              <th className="px-3 py-3 text-left font-medium">分類</th>
              <th className="px-3 py-3 text-right font-medium">投稿者一致</th>
              <th className="px-3 py-3 text-right font-medium">タグ類似</th>
              <th className="px-3 py-3 text-right font-medium">価格</th>
              <th className="px-3 py-3 text-right font-medium">発売日</th>
              <th className="px-3 py-3 text-right font-medium">レビュー数</th>
              <th className="px-3 py-3 text-right font-medium">好評率</th>
              <th className="px-3 py-3 text-right font-medium">推定販売本数</th>
              <th className="px-3 py-3 text-right font-medium">推定売上</th>
              <th className="px-3 py-3 text-right font-medium">現在同接</th>
              <th className="px-3 py-3 text-right font-medium">直近勢い</th>
              <th className="px-3 py-3 text-right font-medium">平均プレイ時間</th>
              <th className="px-3 py-3 text-left font-medium">主要タグ</th>
              <th className="px-3 py-3 text-left font-medium">信頼度診断</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.classification}-${row.appId}`} className="border-b border-slate-100 align-top hover:bg-slate-50">
                <td className="px-3 py-3">
                  <div className="flex items-center gap-3">
                    <a
                      href={`https://store.steampowered.com/app/${row.appId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="h-11 w-20 shrink-0 rounded bg-slate-200 bg-cover bg-center"
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
                      <p className="mt-1 text-[11px] text-slate-400">AppID: {row.appId}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3">
                  <ClassificationPill row={row} />
                </td>
                <td className="px-3 py-3 text-right text-slate-700">
                  <ReviewerOverlapCell row={row} />
                </td>
                <td className="px-3 py-3 text-right text-slate-700">{formatPercent(row.tagSimilarity)}</td>
                <td className="px-3 py-3 text-right text-slate-700">{formatPrice(row.price, currency)}</td>
                <td className="px-3 py-3 text-right text-slate-700">{row.releaseDate}</td>
                <td className="px-3 py-3 text-right text-slate-700">{formatShortNumber(row.totalReviews)}</td>
                <td className="px-3 py-3 text-right text-slate-700">{formatPercent(row.positiveRate)}</td>
                <td className="px-3 py-3 text-right text-slate-700">{formatShortNumber(row.estimatedCopiesSold)}</td>
                <td className="px-3 py-3 text-right text-slate-700">{formatPrice(row.estimatedGrossRevenue, currency)}</td>
                <td className="px-3 py-3 text-right text-slate-700">{formatNullableNumber(row.currentPlayers)}</td>
                <td className="px-3 py-3 text-right">
                  <p className="font-semibold text-slate-900">{row.momentumScore}</p>
                  <p className="text-xs text-slate-500">{row.momentumLabel}</p>
                  <p className="text-[11px] text-slate-400">
                    {row.recentReviewActivity7d.isCapped ? ">= " : ""}
                    {row.recentReviewActivity7d.reviewCount.toLocaleString("ja-JP")}件/7日
                  </p>
                </td>
                <td className="px-3 py-3 text-right text-slate-700">{formatPlaytime(row.averagePlaytimeHours)}</td>
                <td className="px-3 py-3 text-slate-600">{row.tags.slice(0, 5).join(" / ") || "-"}</td>
                <td className="px-3 py-3">
                  <ul className="max-w-64 space-y-1 text-xs leading-5 text-slate-600">
                    {row.estimateDiagnostics.map((item) => (
                      <li key={item}>・{item}</li>
                    ))}
                  </ul>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ClassificationDescription({ rows }: { rows: AudienceOverlapGame[] }) {
  const visibleClassifications = CLASSIFICATION_ORDER.filter((classification) =>
    rows.some((row) => row.classification === classification),
  );

  if (!visibleClassifications.length) {
    return <p className="mt-1 text-xs leading-5 text-slate-500">候補を取得すると、分類カテゴリの意味をここに表示します。</p>;
  }

  return (
    <div className="mt-3 grid gap-2 lg:grid-cols-2">
      {visibleClassifications.map((classification) => (
        <div key={classification} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: CLASSIFICATION_COLORS[classification] }}
            />
            <p className="text-xs font-semibold text-slate-800">{CLASSIFICATION_LABELS[classification]}</p>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">{CLASSIFICATION_DESCRIPTIONS[classification]}</p>
        </div>
      ))}
    </div>
  );
}

function ReviewerOverlapCell({ row }: { row: AudienceOverlapGame }) {
  if (row.classification === "target") {
    return (
      <div className="text-right">
        <p className="font-semibold text-slate-900">対象</p>
        <p className="text-[11px] text-slate-400">
          {row.targetReviewerSampleSize.toLocaleString("ja-JP")}人サンプル
        </p>
      </div>
    );
  }

  return (
    <div className="text-right">
      <p className="font-semibold text-slate-900">{formatPercent(row.reviewOverlapPercent)}</p>
      <p className="text-[11px] text-slate-400">
        {row.sharedReviewers.toLocaleString("ja-JP")} / {row.targetReviewerSampleSize.toLocaleString("ja-JP")}人
      </p>
    </div>
  );
}

function PositioningMap({ rows, currency }: { rows: AudienceOverlapGame[]; currency: CurrencyCode }) {
  const points = rows
    .filter((row) => row.price >= 0 && row.positiveRate >= 0)
    .map((row) => ({
      ...row,
      x: row.price,
      y: row.positiveRate,
      z: Math.max(Math.log10(row.estimatedGrossRevenue + 1) * 80, 40),
    }));
  const classes = Array.from(new Set(points.map((point) => point.classification)));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3">
        <h3 className="font-semibold text-slate-900">競合ポジショニングマップ</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          X軸は価格、Y軸は好評率、円形画像のサイズは推定売上です。枠色は競合分類を表します。
        </p>
      </div>
      <div className="h-[360px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 16, right: 16, bottom: 16, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis
              dataKey="x"
              name="価格"
              tickFormatter={(value) => formatPrice(Number(value), currency)}
              type="number"
            />
            <YAxis dataKey="y" name="好評率" tickFormatter={(value) => `${Number(value).toFixed(0)}%`} type="number" />
            <ZAxis dataKey="z" range={[80, 900]} />
            <Tooltip content={<PositionTooltip currency={currency} />} />
            {classes.map((classification) => (
              <Scatter
                key={classification}
                name={classification === "target" ? "対象" : CLASSIFICATION_LABELS[classification]}
                data={points.filter((point) => point.classification === classification)}
                fill={CLASSIFICATION_COLORS[classification]}
                shape={(props: unknown) => <GameImagePoint {...(props as GameImagePointProps)} />}
              />
            ))}
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

interface GameImagePointProps {
  cx?: number | string;
  cy?: number | string;
  fill?: string;
  payload?: AudienceOverlapGame & { z?: number };
}

function GameImagePoint({ cx, cy, fill, payload }: GameImagePointProps) {
  const x = Number(cx ?? 0);
  const y = Number(cy ?? 0);
  if (!payload || !Number.isFinite(x) || !Number.isFinite(y)) return null;

  const revenueScale = Math.sqrt(Number(payload.z ?? 160)) * 2.4;
  const minimumSize = payload.classification === "target" ? 42 : 30;
  const size = Math.max(minimumSize, Math.min(58, revenueScale));
  const radius = size / 2;
  const strokeColor = fill || CLASSIFICATION_COLORS[payload.classification];
  const clipId = `position-map-icon-${payload.classification}-${payload.appId}`;

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <circle cx={x} cy={y} r={radius - 3} />
        </clipPath>
      </defs>
      <circle cx={x} cy={y} r={radius} fill="#fff" stroke={strokeColor} strokeWidth={payload.classification === "target" ? 3 : 2} />
      {payload.headerImage ? (
        <image
          href={payload.headerImage}
          x={x - radius + 3}
          y={y - radius + 3}
          width={(radius - 3) * 2}
          height={(radius - 3) * 2}
          preserveAspectRatio="xMidYMid slice"
          clipPath={`url(#${clipId})`}
        />
      ) : (
        <circle cx={x} cy={y} r={radius - 5} fill={strokeColor} opacity={0.78} />
      )}
    </g>
  );
}

function PositionTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload: AudienceOverlapGame }>;
  currency: CurrencyCode;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs shadow-lg">
      <p className="font-semibold text-slate-900">{row.name}</p>
      <p className="mt-1 text-slate-600">分類: {row.classificationLabel}</p>
      <p className="text-slate-600">価格: {formatPrice(row.price, currency)}</p>
      <p className="text-slate-600">好評率: {formatPercent(row.positiveRate)}</p>
      <p className="text-slate-600">推定売上: {formatPrice(row.estimatedGrossRevenue, currency)}</p>
      <p className="text-slate-600">推定販売本数: {formatShortNumber(row.estimatedCopiesSold)}</p>
      <p className="text-slate-600">投稿者一致: {formatReviewerOverlap(row)}</p>
      <p className="text-slate-600">タグ類似: {formatPercent(row.tagSimilarity)}</p>
    </div>
  );
}

function CandidateTable({
  title,
  description,
  rows,
  scoreLabel,
  scoreAccessor,
  scoreFormatter = formatPercent,
  currency,
  className = "",
  showReviewerOverlapDetail = false,
}: {
  title: string;
  description: string;
  rows: AudienceOverlapGame[];
  scoreLabel: string;
  scoreAccessor: (row: AudienceOverlapGame) => number;
  scoreFormatter?: (value: number) => string;
  currency: CurrencyCode;
  className?: string;
  showReviewerOverlapDetail?: boolean;
}) {
  return (
    <section className={`overflow-hidden rounded-xl border border-slate-200 bg-white ${className}`}>
      <div className="border-b border-slate-200 p-4">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[1080px] text-sm">
          <thead className="sticky top-0 z-10 bg-white">
            <tr className="border-b border-slate-200 text-xs text-slate-500">
              <th className="px-3 py-3 text-left font-medium">ゲーム</th>
              <th className="px-3 py-3 text-left font-medium">分類</th>
              <th className="px-3 py-3 text-right font-medium">{scoreLabel}</th>
              <th className="px-3 py-3 text-right font-medium">タグ類似</th>
              <th className="px-3 py-3 text-right font-medium">直近勢い</th>
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
                <td className="px-3 py-3">
                  <ClassificationPill row={row} />
                </td>
                <td className="px-3 py-3 text-right">
                  <ScorePill value={scoreAccessor(row)} formatter={scoreFormatter} />
                  {showReviewerOverlapDetail && (
                    <p className="mt-1 text-[11px] text-slate-400">
                      {row.sharedReviewers.toLocaleString("ja-JP")} /{" "}
                      {row.targetReviewerSampleSize.toLocaleString("ja-JP")}人
                    </p>
                  )}
                </td>
                <td className="px-3 py-3 text-right text-slate-700">{formatPercent(row.tagSimilarity)}</td>
                <td className="px-3 py-3 text-right">
                  <p className="font-semibold text-slate-900">{row.momentumScore}</p>
                  <p className="text-xs text-slate-500">{row.momentumLabel}</p>
                </td>
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

function ClassificationPill({ row }: { row: AudienceOverlapGame }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-1 text-xs font-medium text-white"
      style={{ backgroundColor: CLASSIFICATION_COLORS[row.classification] }}
    >
      {row.classificationLabel}
    </span>
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
