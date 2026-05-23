"use client";

import { useEffect, useState } from "react";
import { DiscoveryGame, DiscoveryMarket, DiscoveryResponse } from "@/types";

interface Props {
  onAnalyze: (appId: string) => void;
  isLoading: boolean;
}

const MARKET_LABELS: Record<DiscoveryMarket, string> = {
  jp: "JP",
  global: "Global",
};

export default function DiscoveryPanel({ onAnalyze, isLoading }: Props) {
  const [market, setMarket] = useState<DiscoveryMarket>("jp");
  const [data, setData] = useState<DiscoveryResponse | null>(null);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    fetch(`/api/discovery?market=${market}`, { signal: controller.signal })
      .then(async (res) => {
        const json = await res.json().catch(() => null);
        if (!res.ok || !json) throw new Error(json?.error || `候補取得に失敗しました: ${res.status}`);
        setData(json);
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
        setError(err instanceof Error ? err.message : "候補取得に失敗しました。");
        setData(null);
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsFetching(false);
      });

    return () => controller.abort();
  }, [market]);

  function selectMarket(nextMarket: DiscoveryMarket) {
    if (nextMarket === market) return;
    setIsFetching(true);
    setError("");
    setMarket(nextMarket);
  }

  return (
    <section className="mt-8 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-blue-700">Research ideas</p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">リサーチ候補</h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            売上上位と新作から、気になるタイトルをすぐに分析できます。
          </p>
        </div>
        <div className="inline-flex w-fit rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          {(Object.keys(MARKET_LABELS) as DiscoveryMarket[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => selectMarket(item)}
              className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                market === item ? "bg-blue-600 text-white" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              {MARKET_LABELS[item]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800">{error}</div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <DiscoverySection
          title="売上上位"
          description="Steamのトップセラーから、今ユーザーがお金を使っているタイトルを表示します。"
          games={data?.topSellers ?? []}
          error={data?.errors?.topSellers}
          isFetching={isFetching}
          onAnalyze={onAnalyze}
          isLoading={isLoading}
        />
        <DiscoverySection
          title="今日の新作 / 直近の新作"
          description="日本時間の今日発売を優先し、少ない日は直近7日の新作で補完します。"
          games={data?.newReleases ?? []}
          error={data?.errors?.newReleases}
          isFetching={isFetching}
          onAnalyze={onAnalyze}
          isLoading={isLoading}
        />
      </div>
    </section>
  );
}

function DiscoverySection({
  title,
  description,
  games,
  error,
  isFetching,
  onAnalyze,
  isLoading,
}: {
  title: string;
  description: string;
  games: DiscoveryGame[];
  error?: string;
  isFetching: boolean;
  onAnalyze: (appId: string) => void;
  isLoading: boolean;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4">
        <h3 className="font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>

      {error ? (
        <div className="p-4 text-sm text-yellow-800">{error}</div>
      ) : isFetching && !games.length ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="grid grid-cols-[96px_1fr] gap-3">
              <div className="h-14 animate-pulse rounded bg-slate-200" />
              <div className="space-y-2 py-1">
                <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
                <div className="h-7 w-36 animate-pulse rounded bg-slate-100" />
              </div>
            </div>
          ))}
        </div>
      ) : games.length ? (
        <div className="divide-y divide-slate-100">
          {games.map((game) => (
            <DiscoveryCard key={`${title}-${game.appId}`} game={game} onAnalyze={onAnalyze} isLoading={isLoading} />
          ))}
        </div>
      ) : (
        <div className="p-4 text-sm text-slate-500">候補を取得できませんでした。手入力で分析できます。</div>
      )}
    </div>
  );
}

function DiscoveryCard({
  game,
  onAnalyze,
  isLoading,
}: {
  game: DiscoveryGame;
  onAnalyze: (appId: string) => void;
  isLoading: boolean;
}) {
  return (
    <article className="grid gap-3 p-3 sm:grid-cols-[128px_1fr]">
      <a
        href={game.storeUrl}
        target="_blank"
        rel="noreferrer"
        className="h-20 rounded-md bg-slate-200 bg-cover bg-center"
        style={{ backgroundImage: game.headerImage ? `url(${game.headerImage})` : undefined }}
        aria-label={`${game.name}をSteamで開く`}
      />
      <div className="min-w-0">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="truncate font-semibold text-slate-900">{game.name}</p>
            <p className="mt-1 text-xs text-slate-500">
              AppID: {game.appId} / {game.releaseDate || "発売日不明"}
            </p>
          </div>
          <span className="w-fit shrink-0 rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
            {game.sectionReason}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="font-semibold text-slate-900">{game.priceText}</span>
          {game.discountText && (
            <span className="rounded bg-green-100 px-1.5 py-0.5 font-semibold text-green-700">{game.discountText}</span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onAnalyze(game.appId)}
            disabled={isLoading}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            分析する
          </button>
          <a
            href={game.storeUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
          >
            Steamで開く
          </a>
        </div>
      </div>
    </article>
  );
}
