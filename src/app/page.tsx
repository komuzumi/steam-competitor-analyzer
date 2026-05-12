"use client";

import { useCallback, useRef, useState } from "react";
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

  const handleSubmit = useCallback(async (appIds: string[]) => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    let timedOut = false;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    const resetStallTimer = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        timedOut = true;
        abort.abort();
      }, 90_000);
    };

    setIsLoading(true);
    setResults([]);
    setErrors([]);
    setGlobalError("");
    setProgress({});

    try {
      resetStallTimer();
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appIds }),
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
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const chunk of lines) {
          const line = chunk.trim();
          if (!line.startsWith("data: ")) continue;
          resetStallTimer();

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
      if (timedOut) {
        setGlobalError("分析がタイムアウトしました。通信状況を確認して、もう一度試してください。");
        return;
      }
      if ((err as Error).name === "AbortError") return;
      setGlobalError(err instanceof Error ? err.message : "予期せぬエラーが発生しました");
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      setIsLoading(false);
      setProgress({});
    }
  }, []);

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-700">Steam market dashboard</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">Steam 競合・市場分析ダッシュボード</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Steam公開情報をもとに、価格、レビュー、言語構成、推定販売本数、推定売上、現在同時接続者数を分析します。
            AI分析と全文CSVは必要な時だけ実行します。
          </p>
        </div>

        <InputForm onSubmit={handleSubmit} isLoading={isLoading} />

        {globalError && (
          <div className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-center">
            <p className="text-sm text-red-700">{globalError}</p>
          </div>
        )}

        {errors.length > 0 && (
          <div className="mt-6 space-y-2">
            {errors.map((err) => (
              <div key={err.appId} className="rounded-lg border border-yellow-200 bg-yellow-50 p-3">
                <p className="text-sm text-yellow-800">
                  AppID {err.appId}: {err.message}
                </p>
              </div>
            ))}
          </div>
        )}

        {isLoading && <LoadingSpinner progress={progress} />}

        {results.length > 0 && (
          <div className="mt-8 space-y-6">
            <div className="flex justify-end">
              <CurrencySelector value={currency} onChange={setCurrency} />
            </div>

            {!isLoading && <ComparisonTable results={results} currency={currency} />}

            {results.map((result) => (
              <TitleCard key={result.appId} data={result} currency={currency} />
            ))}

            {!isLoading && <MarkdownExport results={results} currency={currency} />}
          </div>
        )}
      </div>
    </main>
  );
}
