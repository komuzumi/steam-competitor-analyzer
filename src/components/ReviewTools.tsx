"use client";

import { useMemo, useRef, useState } from "react";
import { AISummaryResult, GameAnalysis, PublicReview } from "@/types";

type AiMode = "representative" | "full_compressed";

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
  return review.weighted_vote_score * 100000 + review.votes_up;
}

function compactReview(review: PublicReview): string {
  const playtime = Math.round(review.playtime_forever / 60);
  return `[${review.language}] (${review.voted_up ? "positive" : "negative"}, playtime: ${playtime}h, helpful: ${review.votes_up}) ${review.review.slice(0, 350)}`;
}

function formatAiReportText(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .replace(/([。！？!?])\s*(?!\n|$)/g, "$1\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildFullReviewCorpus(reviews: PublicReview[]): string {
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
    .slice(0, 80);
  const negative = reviews
    .filter((review) => !review.voted_up)
    .sort((a, b) => reviewRank(b) - reviewRank(a))
    .slice(0, 80);
  const recent = [...reviews].sort((a, b) => b.timestamp_created - a.timestamp_created).slice(0, 40);

  return [
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
    <div className="rounded-lg bg-gray-50 p-3">
      <p className="mb-1 text-sm font-medium text-gray-700">{title}</p>
      <p className="whitespace-pre-wrap text-sm leading-6 text-gray-600">{formatAiReportText(content)}</p>
    </div>
  );
}

interface Props {
  data: GameAnalysis;
}

export default function ReviewTools({ data }: Props) {
  const [aiMode, setAiMode] = useState<AiMode>("representative");
  const [aiSummary, setAiSummary] = useState<AISummaryResult | undefined>(data.aiSummary);
  const [aiStatus, setAiStatus] = useState<string>("");
  const [reviewCache, setReviewCache] = useState<PublicReview[] | null>(null);
  const [fetchProgress, setFetchProgress] = useState<{ fetched: number; total: number } | null>(null);
  const [isFetchingReviews, setIsFetchingReviews] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [csvStatus, setCsvStatus] = useState<string>("");
  const inFlightFullFetch = useRef<Promise<PublicReview[]> | null>(null);

  const cacheLabel = useMemo(() => {
    if (!reviewCache) return "未取得";
    return `${formatNumber(reviewCache.length)}件をページ内に一時保持中`;
  }, [reviewCache]);

  async function fetchFullReviews(): Promise<PublicReview[]> {
    if (reviewCache) return reviewCache;
    if (inFlightFullFetch.current) return inFlightFullFetch.current;

    if (data.totalReviews >= 50_000) {
      const ok = window.confirm(
        `${data.name} は約${formatNumber(data.totalReviews)}件のレビューがあります。全文取得は時間とブラウザメモリを多く使う可能性があります。続行しますか？`,
      );
      if (!ok) throw new Error("全文レビュー取得をキャンセルしました");
    }

    const promise = (async () => {
      setIsFetchingReviews(true);
      setCsvStatus("");
      setFetchProgress({ fetched: 0, total: data.totalReviews });
      const res = await fetch(`/api/reviews/stream?appId=${encodeURIComponent(data.appId)}`);
      if (!res.ok || !res.body) {
        throw new Error(`レビュー取得に失敗しました: ${res.status}`);
      }

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
            if (event.fetched % 500 === 0) {
              setFetchProgress({ fetched: event.fetched, total: event.total });
            }
          }
          if (event.type === "progress" || event.type === "done") {
            setFetchProgress({ fetched: event.fetched, total: event.total });
          }
        }
      }

      setReviewCache(reviews);
      return reviews;
    })();

    inFlightFullFetch.current = promise;

    try {
      return await promise;
    } finally {
      setIsFetchingReviews(false);
      inFlightFullFetch.current = null;
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
      };

      if (aiMode === "full_compressed") {
        setAiStatus("全文レビューを取得中...");
        const reviews = await fetchFullReviews();
        setAiStatus("全文レビューを圧縮してAI分析中...");
        body = {
          ...body,
          corpus: buildFullReviewCorpus(reviews),
        };
      } else {
        setAiStatus("代表レビュー200件を取得してAI分析中...");
      }

      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = await res.json();
      if (!res.ok) {
        throw new Error(payload.error || "AI分析に失敗しました");
      }

      setAiSummary(payload.aiSummary as AISummaryResult);
      setAiStatus(aiMode === "representative" ? "代表レビューで分析しました" : "全文レビューの圧縮データで分析しました");
    } catch (err) {
      setAiStatus(err instanceof Error ? err.message : "AI分析に失敗しました");
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleCsvDownload() {
    setCsvStatus("");
    try {
      if (!reviewCache) {
        const params = new URLSearchParams({
          appId: data.appId,
          name: data.name,
        });
        downloadFromUrl(
          `/api/reviews/csv?${params}`,
          `${data.appId}-${data.name.replace(/[\\/:*?"<>|]/g, "_")}-reviews.csv`,
        );
        setCsvStatus("CSVダウンロードを開始しました。未取得の場合はサーバーから直接生成します。");
        return;
      }

      const reviews = await fetchFullReviews();
      const csv = makeCsv(reviews);
      downloadText(`${data.appId}-${data.name.replace(/[\\/:*?"<>|]/g, "_")}-reviews.csv`, csv, "text/csv;charset=utf-8");
      setCsvStatus(reviewCache ? "一時保持データからCSVを生成しました" : "レビューを取得してCSVを生成しました");
    } catch (err) {
      setCsvStatus(err instanceof Error ? err.message : "CSV生成に失敗しました");
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-2 font-semibold text-gray-800">AI分析・CSV</h4>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1">
              <button
                type="button"
                onClick={() => setAiMode("representative")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                  aiMode === "representative" ? "bg-white text-blue-700 shadow-sm" : "text-gray-600"
                }`}
                disabled={isAnalyzing || isFetchingReviews}
              >
                代表200件
              </button>
              <button
                type="button"
                onClick={() => setAiMode("full_compressed")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md ${
                  aiMode === "full_compressed" ? "bg-white text-blue-700 shadow-sm" : "text-gray-600"
                }`}
                disabled={isAnalyzing || isFetchingReviews}
              >
                全文取得＋圧縮
              </button>
            </div>

            <div className="flex gap-2">
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
                onClick={handleCsvDownload}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isAnalyzing || isFetchingReviews}
              >
                {isFetchingReviews ? "取得中..." : "CSV"}
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-1 text-xs text-gray-500">
            <p>一時レビュー: {cacheLabel}</p>
            {fetchProgress && (
              <p>
                全文取得: {formatNumber(fetchProgress.fetched)} / {formatNumber(fetchProgress.total)}件
              </p>
            )}
            {aiStatus && <p className="text-blue-700">{aiStatus}</p>}
            {csvStatus && <p className="text-blue-700">{csvStatus}</p>}
          </div>
        </div>
      </div>

      {aiSummary && (
        <div>
          <h4 className="mb-2 font-semibold text-gray-800">AI分析レポート</h4>
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
