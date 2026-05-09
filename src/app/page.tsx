"use client";

import { useState, useRef, useCallback } from "react";
import InputForm from "@/components/InputForm";
import LoadingSpinner from "@/components/LoadingSpinner";
import TitleCard from "@/components/TitleCard";
import ComparisonTable from "@/components/ComparisonTable";
import MarkdownExport from "@/components/MarkdownExport";
import CurrencySelector from "@/components/CurrencySelector";
import { GameAnalysis, SSEEvent } from "@/types";
import { CurrencyCode } from "@/lib/currency";

interface ProgressItem {
  appId: string;
  appName?: string;
  phase: string;
  detail?: string;
}

export default function Home() {
  const [isLoading, setIsLoading] = useState(false);
  const [results, setResults] = useState<GameAnalysis[]>([]);
  const [errors, setErrors] = useState<{ appId: string; message: string }[]>([]);
  const [globalError, setGlobalError] = useState<string>("");
  const [currency, setCurrency] = useState<CurrencyCode>("JPY");
  const [progress, setProgress] = useState<Record<string, ProgressItem>>({});
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = useCallback(async (appIds: string[], reviewLimit: number) => {
    // 前回のリクエストをキャンセル
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setIsLoading(true);
    setResults([]);
    setErrors([]);
    setGlobalError("");
    setProgress({});

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appIds, reviewLimit }),
        signal: abort.signal,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `サーバーエラー: ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("ストリームの読み取りに失敗しました");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // SSEメッセージをパース
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const chunk of lines) {
          const line = chunk.trim();
          if (!line.startsWith("data: ")) continue;

          const json = line.slice(6);
          let event: SSEEvent;
          try {
            event = JSON.parse(json);
          } catch {
            continue;
          }

          switch (event.type) {
            case "progress":
              setProgress((prev) => ({
                ...prev,
                [event.appId]: {
                  appId: event.appId,
                  appName: event.appName,
                  phase: event.phase,
                  detail: event.detail,
                },
              }));
              break;
            case "result":
              setResults((prev) => [...prev, event.data]);
              // 完了したタイトルを進捗から除去
              setProgress((prev) => {
                const next = { ...prev };
                delete next[event.data.appId];
                return next;
              });
              break;
            case "error":
              setErrors((prev) => [...prev, { appId: event.appId, message: event.message }]);
              setProgress((prev) => {
                const next = { ...prev };
                delete next[event.appId];
                return next;
              });
              break;
            case "done":
              break;
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setGlobalError(
        err instanceof Error ? err.message : "予期せぬエラーが発生しました"
      );
    } finally {
      setIsLoading(false);
      setProgress({});
    }
  }, []);

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Steam 競合調査AIレポート
          </h1>
          <p className="mt-2 text-gray-600 text-sm">
            Steam URLまたはAppIDを入力すると、レビュー全件取得・仮説売上・AI要約レポートを生成します
          </p>
        </div>

        {/* 入力フォーム */}
        <InputForm onSubmit={handleSubmit} isLoading={isLoading} />

        {/* エラー表示 */}
        {globalError && (
          <div className="mt-6 bg-red-50 border border-red-200 rounded-lg p-4 text-center">
            <p className="text-red-700 text-sm">{globalError}</p>
          </div>
        )}

        {errors.length > 0 && (
          <div className="mt-6 space-y-2">
            {errors.map((err) => (
              <div
                key={err.appId}
                className="bg-yellow-50 border border-yellow-200 rounded-lg p-3"
              >
                <p className="text-yellow-800 text-sm">
                  AppID {err.appId}: {err.message}
                </p>
              </div>
            ))}
          </div>
        )}

        {/* ローディング・進捗 */}
        {isLoading && <LoadingSpinner progress={progress} />}

        {/* 結果表示 */}
        {results.length > 0 && (
          <div className="mt-8 space-y-6">
            {/* 通貨切り替え */}
            <div className="flex justify-end">
              <CurrencySelector value={currency} onChange={setCurrency} />
            </div>

            {/* 比較テーブル */}
            {!isLoading && <ComparisonTable results={results} currency={currency} />}

            {/* タイトル別カード */}
            {results.map((result) => (
              <TitleCard key={result.appId} data={result} currency={currency} />
            ))}

            {/* Markdownエクスポート */}
            {!isLoading && <MarkdownExport results={results} currency={currency} />}
          </div>
        )}
      </div>
    </main>
  );
}
