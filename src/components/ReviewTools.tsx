"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AISummaryResult, GameAnalysis, PublicReview } from "@/types";

type AiMode = "representative" | "full_compressed";

const GEMINI_KEY_STORAGE = "steam-analyzer-gemini-api-key";

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

function PlaytimeSentimentChart({ reviews }: { reviews: PublicReview[] }) {
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
        <p className="text-xs text-slate-500">全文レビュー取得後の一時データだけで集計します。</p>
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
  const [reviewCaches, setReviewCaches] = useState<Record<string, PublicReview[]>>({});
  const [fetchProgress, setFetchProgress] = useState<{ fetched: number; total: number } | null>(null);
  const [isFetchingReviews, setIsFetchingReviews] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [csvStatus, setCsvStatus] = useState<string>("");
  const inFlightFullFetch = useRef<Partial<Record<string, Promise<PublicReview[]>>>>({});

  useEffect(() => {
    if (geminiApiKey) window.localStorage.setItem(GEMINI_KEY_STORAGE, geminiApiKey);
    else window.localStorage.removeItem(GEMINI_KEY_STORAGE);
  }, [geminiApiKey]);

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

  async function fetchFullReviews(language: string): Promise<PublicReview[]> {
    if (reviewCaches[language]) return reviewCaches[language];
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
      delete inFlightFullFetch.current[language];
    }
  }

  async function handleAiAnalyze() {
    setIsAnalyzing(true);
    setAiStatus("");
    try {
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
        setAiStatus(`${selectedLanguageLabel}の全文レビューを圧縮してAI分析中...`);
        body = {
          ...body,
          corpus: buildFullReviewCorpus(reviews, selectedLanguageLabel),
        };
      } else {
        setAiStatus(`${selectedLanguageLabel}の代表レビュー200件を取得してAI分析中...`);
      }

      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "AI分析に失敗しました");

      setAiSummary(payload.aiSummary as AISummaryResult);
      setAiStatus(
        aiMode === "representative"
          ? `${selectedLanguageLabel}の代表レビューで分析しました`
          : `${selectedLanguageLabel}の全文圧縮データで分析しました`,
      );
    } catch (err) {
      setAiStatus(err instanceof Error ? err.message : "AI分析に失敗しました");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleCsvDownload() {
    setCsvStatus("");
    try {
      if (!allReviewCache) {
        const params = new URLSearchParams({ appId: data.appId, name: data.name });
        downloadFromUrl(`/api/reviews/csv?${params}`, `${data.appId}-${data.name.replace(/[\\/:*?"<>|]/g, "_")}-reviews.csv`);
        setCsvStatus("CSVダウンロードを開始しました。未取得の場合はサーバーから直接生成します。");
        return;
      }

      const csv = makeCsv(allReviewCache);
      downloadText(`${data.appId}-${data.name.replace(/[\\/:*?"<>|]/g, "_")}-reviews.csv`, csv, "text/csv;charset=utf-8");
      setCsvStatus("ページ内の一時レビューからCSVを生成しました");
    } catch (err) {
      setCsvStatus(err instanceof Error ? err.message : "CSV生成に失敗しました");
    }
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
            全文キャッシュ: {allReviewCache ? `${formatNumber(allReviewCache.length)}件` : "未取得"}
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
            onClick={() => fetchFullReviews("all").catch((err) => setCsvStatus(err.message))}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isAnalyzing || isFetchingReviews}
          >
            {isFetchingReviews ? "取得中..." : "全文レビュー取得"}
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
            <p>{selectedLanguageLabel}: {formatNumber(activeReviewCache.length)}件をページ内に一時保持中</p>
          )}
          {fetchProgress && (
            <p>
              全文取得: {formatNumber(fetchProgress.fetched)} / {formatNumber(fetchProgress.total)}件
            </p>
          )}
          {aiStatus && <p className="text-blue-700">{aiStatus}</p>}
          {csvStatus && <p className="text-blue-700">{csvStatus}</p>}
        </div>
      </div>

      {allReviewCache && <PlaytimeSentimentChart reviews={allReviewCache} />}

      {aiSummary && (
        <div>
          <h4 className="mb-2 font-semibold text-slate-900">AI分析レポート</h4>
          <div className="space-y-3">
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
