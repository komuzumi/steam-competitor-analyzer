"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AISampleMeta, AISummaryResult, GameAnalysis, PublicReview } from "@/types";

type AiMode = "representative" | "full_compressed";

const GEMINI_KEY_STORAGE = "steam-analyzer-gemini-api-key";
const AI_CLIENT_TIMEOUT_MS = 120_000;

function formatNumber(value: number): string {
  return value.toLocaleString("ja-JP");
}

function csvEscape(value: string | number | boolean | undefined): string {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function makeCsv(reviews: PublicReview[]): string {
  const header = [
    "recommendationid",
    "language",
    "voted_up",
    "timestamp_created",
    "timestamp_updated",
    "votes_up",
    "weighted_vote_score",
    "playtime_forever_minutes",
    "playtime_at_review_minutes",
    "review",
  ];
  const rows = reviews.map((review) =>
    [
      review.recommendationid,
      review.language,
      review.voted_up,
      review.timestamp_created,
      review.timestamp_updated,
      review.votes_up,
      review.weighted_vote_score,
      review.playtime_forever,
      review.playtime_at_review,
      review.review,
    ]
      .map(csvEscape)
      .join(","),
  );

  return [header.join(","), ...rows].join("\r\n");
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadFromUrl(url: string, filename: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_");
}

function reviewRank(review: PublicReview): number {
  return review.weighted_vote_score * 100_000 + review.votes_up + review.timestamp_created / 1_000_000;
}

function compactReview(review: PublicReview): string {
  const playtime = Math.round(review.playtime_forever / 60);
  return `[${review.language}] (${review.voted_up ? "positive" : "negative"}, playtime: ${playtime}h, helpful: ${review.votes_up}) ${review.review.slice(0, 350)}`;
}

function formatAiReportText(content: unknown): string {
  const text = Array.isArray(content) ? content.map((item) => String(item)).join("\n") : String(content ?? "");

  return text
    .replace(/\r\n/g, "\n")
    .replace(/([。！？?])\s*(?!\n|$)/g, "$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildFullReviewCorpus(reviews: PublicReview[], languageLabel: string): string {
  const languageMap = new Map<string, { count: number; positive: number; negative: number }>();
  for (const review of reviews) {
    const current = languageMap.get(review.language) ?? { count: 0, positive: 0, negative: 0 };
    current.count++;
    if (review.voted_up) current.positive++;
    else current.negative++;
    languageMap.set(review.language, current);
  }

  const languageLines = Array.from(languageMap.entries())
    .map(([language, stats]) => ({ language, ...stats }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)
    .map((stats) => `${stats.language}: ${stats.count} reviews, ${stats.positive} positive, ${stats.negative} negative`);

  const positive = reviews
    .filter((review) => review.voted_up)
    .sort((a, b) => reviewRank(b) - reviewRank(a))
    .slice(0, 90);
  const negative = reviews
    .filter((review) => !review.voted_up)
    .sort((a, b) => reviewRank(b) - reviewRank(a))
    .slice(0, 90);
  const recent = [...reviews].sort((a, b) => b.timestamp_created - a.timestamp_created).slice(0, 40);

  return [
    `Scope: ${languageLabel}`,
    `Total reviews fetched: ${reviews.length}`,
    "",
    "## Language distribution",
    languageLines.join("\n"),
    "",
    "## Helpful positive reviews",
    positive.map(compactReview).join("\n---\n"),
    "",
    "## Helpful negative reviews",
    negative.map(compactReview).join("\n---\n"),
    "",
    "## Recent reviews",
    recent.map(compactReview).join("\n---\n"),
  ].join("\n");
}

function SummarySection({ title, content }: { title: string; content: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3">
      <p className="mb-1 text-sm font-medium text-slate-700">{title}</p>
      <p className="whitespace-pre-wrap text-sm leading-6 text-slate-600">{formatAiReportText(content)}</p>
    </div>
  );
}

function buildPublicReviewSampleMeta({
  reviews,
  mode,
  language,
  languageLabel,
}: {
  reviews: PublicReview[];
  mode: AiMode;
  language: string;
  languageLabel: string;
}): AISampleMeta {
  const positiveCount = reviews.filter((review) => review.voted_up).length;
  const negativeCount = reviews.length - positiveCount;
  const playtimes = reviews.map((review) => review.playtime_forever).filter((minutes) => minutes > 0);
  const timestamps = reviews
    .map((review) => review.timestamp_created)
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0)
    .sort((a, b) => a - b);
  const languageCounts = new Map<string, number>();

  for (const review of reviews) {
    languageCounts.set(review.language, (languageCounts.get(review.language) ?? 0) + 1);
  }

  return {
    mode,
    language,
    languageLabel,
    reviewCount: reviews.length,
    positiveCount,
    negativeCount,
    positiveRate: reviews.length > 0 ? (positiveCount / reviews.length) * 100 : 0,
    averagePlaytimeHours:
      playtimes.length > 0 ? playtimes.reduce((sum, minutes) => sum + minutes, 0) / playtimes.length / 60 : null,
    oldestReviewDate:
      timestamps.length > 0 ? new Date(timestamps[0] * 1000).toISOString().slice(0, 10) : null,
    newestReviewDate:
      timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1] * 1000).toISOString().slice(0, 10) : null,
    topLanguages: Array.from(languageCounts.entries())
      .map(([reviewLanguage, count]) => ({ language: reviewLanguage, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    selectionRule:
      mode === "representative"
        ? "直近365日のレビューから、好評/不評を混ぜて最大200件を抽出。weighted_vote_score、参考票数、投稿日時を優先します。"
        : "このページで一時取得した全文レビューを圧縮し、好評/不評/直近レビューを混ぜてAIに渡します。",
  };
}

function AiSampleMetaPanel({ meta }: { meta: AISampleMeta }) {
  const period =
    meta.oldestReviewDate && meta.newestReviewDate ? `${meta.oldestReviewDate} - ${meta.newestReviewDate}` : "-";
  const playtime = meta.averagePlaytimeHours == null ? "-" : `${meta.averagePlaytimeHours.toFixed(1)}h`;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-semibold text-slate-800">AI分析サンプル</p>
          <p className="text-xs text-slate-500">{meta.selectionRule}</p>
        </div>
        <span className="w-fit rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
          {meta.mode === "representative" ? "代表200件" : "全文圧縮"}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs text-slate-500">対象</p>
          <p className="font-medium text-slate-800">{meta.languageLabel}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">サンプル数</p>
          <p className="font-medium text-slate-800">{formatNumber(meta.reviewCount)}件</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">好評/不評</p>
          <p className="font-medium text-slate-800">
            {formatNumber(meta.positiveCount)} / {formatNumber(meta.negativeCount)} ({meta.positiveRate.toFixed(1)}%)
          </p>
        </div>
        <div>
          <p className="text-xs text-slate-500">平均プレイ時間</p>
          <p className="font-medium text-slate-800">{playtime}</p>
        </div>
        <div>
          <p className="text-xs text-slate-500">投稿期間</p>
          <p className="font-medium text-slate-800">{period}</p>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <p className="text-xs text-slate-500">言語内訳</p>
          <p className="font-medium text-slate-800">
            {meta.topLanguages.length > 0
              ? meta.topLanguages
                  .map((item) => `${item.language}: ${formatNumber(item.count)}件`)
                  .join(" / ")
              : "-"}
          </p>
        </div>
      </div>
    </div>
  );
}

function buildAiSummaryMarkdown({
  gameName,
  appId,
  languageLabel,
  aiMode,
  summary,
  sampleMeta,
}: {
  gameName: string;
  appId: string;
  languageLabel: string;
  aiMode: AiMode;
  summary: AISummaryResult;
  sampleMeta?: AISampleMeta | null;
}): string {
  const sampleLines = sampleMeta
    ? [
        `- サンプル数: ${sampleMeta.reviewCount}`,
        `- サンプル好評/不評: ${sampleMeta.positiveCount} / ${sampleMeta.negativeCount} (${sampleMeta.positiveRate.toFixed(1)}%)`,
        `- サンプル投稿期間: ${sampleMeta.oldestReviewDate ?? "-"} - ${sampleMeta.newestReviewDate ?? "-"}`,
        `- サンプル平均プレイ時間: ${
          sampleMeta.averagePlaytimeHours == null ? "-" : `${sampleMeta.averagePlaytimeHours.toFixed(1)}h`
        }`,
        `- サンプル抽出ルール: ${sampleMeta.selectionRule}`,
      ]
    : [];

  return [
    `# AIレビュー分析レポート: ${gameName}`,
    "",
    `- AppID: ${appId}`,
    `- 分析対象: ${languageLabel}`,
    `- AIモード: ${aiMode === "representative" ? "代表200件" : "全文圧縮"}`,
    `- 生成日時: ${new Date().toLocaleString("ja-JP")}`,
    ...sampleLines,
    "",
    "## 高評価の理由",
    formatAiReportText(summary.positiveReasons),
    "",
    "## 低評価の理由",
    formatAiReportText(summary.negativeReasons),
    "",
    "## 頻出する不満",
    formatAiReportText(summary.frequentComplaints),
    "",
    "## 企画に活かせる示唆",
    formatAiReportText(summary.planningInsights),
    "",
    "## 海外展開時の注意点",
    formatAiReportText(summary.globalExpansionNotes),
    "",
  ].join("\n");
}

function getPlaytimeBucket(minutes: number): string {
  const hours = minutes / 60;
  if (hours < 1) return "<1h";
  if (hours < 5) return "1-5h";
  if (hours < 10) return "5-10h";
  if (hours < 20) return "10-20h";
  if (hours < 50) return "20-50h";
  if (hours < 100) return "50-100h";
  return "100h+";
}

function PlaytimeSentimentChart({ reviews, scopeLabel }: { reviews: PublicReview[]; scopeLabel: string }) {
  const buckets = useMemo(() => {
    const order = ["<1h", "1-5h", "5-10h", "10-20h", "20-50h", "50-100h", "100h+"];
    const map = new Map(order.map((bucket) => [bucket, { bucket, positive: 0, negative: 0, total: 0 }]));
    for (const review of reviews) {
      const bucket = getPlaytimeBucket(review.playtime_forever);
      const current = map.get(bucket);
      if (!current) continue;
      current.total++;
      if (review.voted_up) current.positive++;
      else current.negative++;
    }
    return order.map((bucket) => map.get(bucket)!).filter((bucket) => bucket.total > 0);
  }, [reviews]);

  if (!buckets.length) return null;

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="mb-3">
        <p className="text-sm font-semibold text-slate-800">プレイ時間別 好評/不評</p>
        <p className="text-xs text-slate-500">
          {scopeLabel}の一時レビュー{formatNumber(reviews.length)}件だけで集計します。
        </p>
      </div>
      <div className="space-y-2">
        {buckets.map((bucket) => {
          const positiveRate = bucket.total > 0 ? (bucket.positive / bucket.total) * 100 : 0;
          const negativeRate = 100 - positiveRate;
          return (
            <div key={bucket.bucket} className="grid grid-cols-[70px_1fr_82px] items-center gap-3 text-xs">
              <span className="font-medium text-slate-600">{bucket.bucket}</span>
              <div className="flex h-4 overflow-hidden rounded-full bg-slate-100">
                <div className="bg-green-500" style={{ width: `${positiveRate}%` }} />
                <div className="bg-red-500" style={{ width: `${negativeRate}%` }} />
              </div>
              <span className="text-right text-slate-500">
                {positiveRate.toFixed(1)}% / {formatNumber(bucket.total)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  data: GameAnalysis;
}

export default function ReviewTools({ data }: Props) {
  const [aiMode, setAiMode] = useState<AiMode>("representative");
  const [selectedLanguage, setSelectedLanguage] = useState("all");
  const [geminiApiKey, setGeminiApiKey] = useState(() =>
    typeof window === "undefined" ? "" : window.localStorage.getItem(GEMINI_KEY_STORAGE) ?? "",
  );
  const [aiSummary, setAiSummary] = useState<AISummaryResult | undefined>(data.aiSummary);
  const [aiStatus, setAiStatus] = useState<string>("");
  const [aiElapsed, setAiElapsed] = useState(0);
  const [reviewCaches, setReviewCaches] = useState<Record<string, PublicReview[]>>({});
  const [fetchProgress, setFetchProgress] = useState<{ fetched: number; total: number } | null>(null);
  const [isFetchingReviews, setIsFetchingReviews] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [csvStatus, setCsvStatus] = useState<string>("");
  const [aiExportStatus, setAiExportStatus] = useState<string>("");
  const [aiSampleMeta, setAiSampleMeta] = useState<AISampleMeta | null>(null);
  const inFlightFullFetch = useRef<Partial<Record<string, Promise<PublicReview[]>>>>({});

  useEffect(() => {
    if (geminiApiKey) window.localStorage.setItem(GEMINI_KEY_STORAGE, geminiApiKey);
    else window.localStorage.removeItem(GEMINI_KEY_STORAGE);
  }, [geminiApiKey]);

  useEffect(() => {
    if (!isAnalyzing) return;
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      setAiElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isAnalyzing]);

  const languageOptions = useMemo(
    () => [
      { value: "all", label: "全言語" },
      ...data.languageStats.slice(0, 20).map((stat) => ({
        value: stat.language,
        label: stat.displayName ?? stat.language,
      })),
    ],
    [data.languageStats],
  );
  const selectedLanguageLabel =
    languageOptions.find((option) => option.value === selectedLanguage)?.label ?? selectedLanguage;
  const allReviewCache = reviewCaches.all;
  const activeReviewCache = reviewCaches[selectedLanguage];
  const visibleReviewCache = useMemo(() => {
    if (activeReviewCache) return activeReviewCache;
    if (selectedLanguage !== "all" && allReviewCache) {
      return allReviewCache.filter((review) => review.language === selectedLanguage);
    }
    return allReviewCache;
  }, [activeReviewCache, allReviewCache, selectedLanguage]);
  const visibleReviewCacheLabel = selectedLanguage === "all" ? "全言語" : selectedLanguageLabel;
  const cacheStatus =
    selectedLanguage !== "all" && visibleReviewCache
      ? `${visibleReviewCacheLabel} ${formatNumber(visibleReviewCache.length)}件`
      : allReviewCache
        ? `全言語 ${formatNumber(allReviewCache.length)}件`
        : "未取得";
  const reviewFilenameSuffix = selectedLanguage === "all" ? "reviews" : `${selectedLanguage}-reviews`;
  const visibleAiStatus = isAnalyzing && aiStatus ? `${aiStatus}（${aiElapsed}秒経過）` : aiStatus;

  async function fetchFullReviews(language: string): Promise<PublicReview[]> {
    if (reviewCaches[language]) return reviewCaches[language];
    if (language !== "all" && reviewCaches.all) {
      const filtered = reviewCaches.all.filter((review) => review.language === language);
      setReviewCaches((prev) => ({ ...prev, [language]: filtered }));
      return filtered;
    }
    if (inFlightFullFetch.current[language]) return inFlightFullFetch.current[language];

    const targetTotal =
      language === "all"
        ? data.totalReviews
        : data.languageStats.find((stat) => stat.language === language)?.count ?? data.totalReviews;

    if (targetTotal >= 50_000) {
      const ok = window.confirm(
        `${data.name} の${selectedLanguageLabel}レビューは約${formatNumber(targetTotal)}件あります。全文取得は時間とブラウザメモリを多く使う可能性があります。続行しますか？`,
      );
      if (!ok) throw new Error("全文レビュー取得をキャンセルしました");
    }

    const promise = (async () => {
      setIsFetchingReviews(true);
      setCsvStatus("");
      setFetchProgress({ fetched: 0, total: targetTotal });
      const params = new URLSearchParams({ appId: data.appId, language });
      const res = await fetch(`/api/reviews/stream?${params}`);
      if (!res.ok || !res.body) throw new Error(`レビュー取得に失敗しました: ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const reviews: PublicReview[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as
            | { type: "meta"; total: number }
            | { type: "review"; review: PublicReview; fetched: number; total: number }
            | { type: "progress"; fetched: number; total: number }
            | { type: "done"; fetched: number; total: number }
            | { type: "error"; message: string };

          if (event.type === "error") throw new Error(event.message);
          if (event.type === "meta") setFetchProgress({ fetched: 0, total: event.total });
          if (event.type === "review") {
            reviews.push(event.review);
            if (event.fetched % 500 === 0) setFetchProgress({ fetched: event.fetched, total: event.total });
          }
          if (event.type === "progress" || event.type === "done") {
            setFetchProgress({ fetched: event.fetched, total: event.total });
          }
        }
      }

      setReviewCaches((prev) => ({ ...prev, [language]: reviews }));
      return reviews;
    })();

    inFlightFullFetch.current[language] = promise;

    try {
      return await promise;
    } finally {
      setIsFetchingReviews(false);
      setFetchProgress(null);
      delete inFlightFullFetch.current[language];
    }
  }

  async function handleAiAnalyze() {
    setIsAnalyzing(true);
    setAiElapsed(0);
    setAiStatus("");
    setAiExportStatus("");
    setAiSampleMeta(null);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), AI_CLIENT_TIMEOUT_MS);

    try {
      let localSampleMeta: AISampleMeta | null = null;
      let body: Record<string, unknown> = {
        appId: data.appId,
        gameName: data.name,
        mode: aiMode,
        language: selectedLanguage,
        geminiApiKey: geminiApiKey.trim() || undefined,
      };

      if (aiMode === "full_compressed") {
        setAiStatus(`${selectedLanguageLabel}の全文レビューを取得中...`);
        const reviews = await fetchFullReviews(selectedLanguage);
        localSampleMeta = buildPublicReviewSampleMeta({
          reviews,
          mode: aiMode,
          language: selectedLanguage,
          languageLabel: selectedLanguageLabel,
        });
        setAiStatus(`${selectedLanguageLabel}の全文レビューを圧縮してGeminiで分析中...`);
        body = {
          ...body,
          corpus: buildFullReviewCorpus(reviews, selectedLanguageLabel),
        };
      } else {
        setAiStatus(`${selectedLanguageLabel}の代表レビュー200件を取得し、Geminiで分析中...`);
      }

      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "AI分析に失敗しました");

      setAiSummary(payload.aiSummary as AISummaryResult);
      setAiSampleMeta((payload.sampleMeta as AISampleMeta | undefined) ?? localSampleMeta);
      setAiStatus(
        aiMode === "representative"
          ? `${selectedLanguageLabel}の代表レビューで分析しました`
          : `${selectedLanguageLabel}の全文圧縮データで分析しました`,
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setAiStatus("AI分析がタイムアウトしました。Gemini APIキーや通信状況を確認して、もう一度試してください。");
      } else {
        setAiStatus(err instanceof Error ? err.message : "AI分析に失敗しました");
      }
    } finally {
      window.clearTimeout(timeout);
      setIsAnalyzing(false);
    }
  }

  async function handleCsvDownload() {
    setCsvStatus("");
    try {
      if (!visibleReviewCache) {
        const params = new URLSearchParams({ appId: data.appId, name: data.name, language: selectedLanguage });
        downloadFromUrl(
          `/api/reviews/csv?${params}`,
          `${data.appId}-${safeFilename(data.name)}-${reviewFilenameSuffix}.csv`,
        );
        setCsvStatus(`${visibleReviewCacheLabel}のCSVダウンロードを開始しました。未取得のためサーバーから直接生成します。`);
        return;
      }

      const csv = makeCsv(visibleReviewCache);
      downloadText(
        `${data.appId}-${safeFilename(data.name)}-${reviewFilenameSuffix}.csv`,
        csv,
        "text/csv;charset=utf-8",
      );
      setCsvStatus(
        `${visibleReviewCacheLabel}のページ内一時レビュー${formatNumber(visibleReviewCache.length)}件からCSVを生成しました`,
      );
    } catch (err) {
      setCsvStatus(err instanceof Error ? err.message : "CSV生成に失敗しました");
    }
  }

  async function handleCopyAiReport() {
    if (!aiSummary) return;
    const markdown = buildAiSummaryMarkdown({
      gameName: data.name,
      appId: data.appId,
      languageLabel: aiSampleMeta?.languageLabel ?? selectedLanguageLabel,
      aiMode: aiSampleMeta?.mode ?? aiMode,
      summary: aiSummary,
      sampleMeta: aiSampleMeta,
    });

    try {
      await navigator.clipboard.writeText(markdown);
      setAiExportStatus("AIレポートをコピーしました");
    } catch {
      setAiExportStatus("クリップボードへのコピーに失敗しました");
    }
  }

  function handleDownloadAiReport() {
    if (!aiSummary) return;
    const markdown = buildAiSummaryMarkdown({
      gameName: data.name,
      appId: data.appId,
      languageLabel: aiSampleMeta?.languageLabel ?? selectedLanguageLabel,
      aiMode: aiSampleMeta?.mode ?? aiMode,
      summary: aiSummary,
      sampleMeta: aiSampleMeta,
    });

    downloadText(
      `${data.appId}-${safeFilename(data.name)}-${aiSampleMeta?.language ?? selectedLanguage}-ai-report.md`,
      markdown,
      "text/markdown;charset=utf-8",
    );
    setAiExportStatus("AIレポートのMarkdown保存を開始しました");
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h4 className="font-semibold text-slate-900">AI分析・レビューエクスポート</h4>
            <p className="text-xs text-slate-500">レビュー本文はDB保存せず、このページのメモリ内だけで一時保持します。</p>
          </div>
          <div className="text-xs text-slate-500">
            全文キャッシュ: {cacheStatus}
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-[1fr_180px_220px]">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Gemini APIキー</span>
            <input
              type="password"
              value={geminiApiKey}
              onChange={(event) => setGeminiApiKey(event.target.value)}
              placeholder="ユーザー側のGemini APIキー（localStorage保存）"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">分析対象</span>
            <select
              value={selectedLanguage}
              onChange={(event) => setSelectedLanguage(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isAnalyzing || isFetchingReviews}
            >
              {languageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className="mb-1 block text-xs font-medium text-slate-600">AIモード</span>
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setAiMode("representative")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${
                  aiMode === "representative" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"
                }`}
                disabled={isAnalyzing || isFetchingReviews}
              >
                代表200件
              </button>
              <button
                type="button"
                onClick={() => setAiMode("full_compressed")}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium ${
                  aiMode === "full_compressed" ? "bg-white text-blue-700 shadow-sm" : "text-slate-600"
                }`}
                disabled={isAnalyzing || isFetchingReviews}
              >
                全文圧縮
              </button>
            </div>
          </div>
        </div>

        <details className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          <summary className="cursor-pointer font-medium text-slate-700">代表200件の定義</summary>
          <p className="mt-2">
            直近365日のレビューから最大200件を抽出します。好評/不評の比率を反映しつつ、不評レビューがある場合は最低25%を目安に確保します。
            抽出時はweighted vote score、参考票数、投稿日時を優先します。
          </p>
        </details>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleAiAnalyze}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isAnalyzing || isFetchingReviews}
          >
            {isAnalyzing ? "AI分析中..." : "AI分析"}
          </button>
          <button
            type="button"
            onClick={() => fetchFullReviews(selectedLanguage).catch((err) => setCsvStatus(err.message))}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isAnalyzing || isFetchingReviews}
          >
            {isFetchingReviews ? "取得中..." : "選択対象の全文レビュー取得"}
          </button>
          <button
            type="button"
            onClick={handleCsvDownload}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isAnalyzing || isFetchingReviews}
          >
            CSV
          </button>
        </div>

        <div className="mt-3 space-y-1 text-xs text-slate-500">
          {activeReviewCache && selectedLanguage !== "all" && (
            <p>
              {selectedLanguageLabel}: {formatNumber(activeReviewCache.length)}件をページ内に一時保持中
            </p>
          )}
          {!activeReviewCache && selectedLanguage !== "all" && visibleReviewCache && (
            <p>
              {selectedLanguageLabel}: 全言語キャッシュから{formatNumber(visibleReviewCache.length)}件を表示中
            </p>
          )}
          {fetchProgress && (
            <p>
              全文取得: {formatNumber(fetchProgress.fetched)} / {formatNumber(fetchProgress.total)}件
            </p>
          )}
          {visibleAiStatus && <p className="text-blue-700">{visibleAiStatus}</p>}
          {aiExportStatus && <p className="text-blue-700">{aiExportStatus}</p>}
          {csvStatus && <p className="text-blue-700">{csvStatus}</p>}
        </div>
      </div>

      {visibleReviewCache && visibleReviewCache.length > 0 && (
        <PlaytimeSentimentChart reviews={visibleReviewCache} scopeLabel={visibleReviewCacheLabel} />
      )}

      {aiSummary && (
        <div>
          <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h4 className="font-semibold text-slate-900">AI分析レポート</h4>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCopyAiReport}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                AIレポートをコピー
              </button>
              <button
                type="button"
                onClick={handleDownloadAiReport}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                Markdown保存
              </button>
            </div>
          </div>
          <div className="space-y-3">
            {aiSampleMeta && <AiSampleMetaPanel meta={aiSampleMeta} />}
            <SummarySection title="高評価の理由" content={aiSummary.positiveReasons} />
            <SummarySection title="低評価の理由" content={aiSummary.negativeReasons} />
            <SummarySection title="頻出する不満" content={aiSummary.frequentComplaints} />
            <SummarySection title="企画に活かせる示唆" content={aiSummary.planningInsights} />
            <SummarySection title="海外展開時の注意点" content={aiSummary.globalExpansionNotes} />
          </div>
        </div>
      )}
    </div>
  );
}
