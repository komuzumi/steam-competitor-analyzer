import { NextRequest } from "next/server";
import {
  extractEditionPrices,
  fetchAppDetails,
  fetchCurrentPlayers,
  fetchLanguageStats,
  fetchReviewPlaytimeSample,
  fetchReviewSummary,
  fetchSteamPurchaseReviewCount,
  parseReleaseYear,
} from "@/lib/steam";
import { estimateSteamMarket, salesEstimateFromMarket } from "@/lib/sales";
import { fetchHistoricalLow } from "@/lib/itad";
import { CURRENCY_OPTIONS } from "@/lib/currency";
import { saveMetricSnapshot } from "@/lib/metricsStore";
import { CurrencyPriceInfo, EditionInfo, GameAnalysis, SSEEvent } from "@/types";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { appIds } = body as { appIds: string[] };

  if (!appIds || !Array.isArray(appIds) || appIds.length === 0 || appIds.length > 5) {
    return new Response(JSON.stringify({ error: "AppIDは1から5件で指定してください" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let isClosed = false;
      let latestProgress: Extract<SSEEvent, { type: "progress" }> | null = null;
      function send(event: SSEEvent) {
        if (isClosed) return;
        if (event.type === "progress") latestProgress = event;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      const heartbeat = setInterval(() => {
        if (!latestProgress) return;
        send({
          ...latestProgress,
          detail: latestProgress.detail || "外部APIの応答を待っています。処理は継続中です。",
        });
      }, 20_000);

      try {
        for (const appId of appIds) {
          try {
            send({ type: "progress", appId, phase: "ストア情報と価格を取得中..." });

            const priceResults = await Promise.all(
              CURRENCY_OPTIONS.map(async (opt) => {
                const [details, historicalLow] = await Promise.all([
                  fetchAppDetails(appId, opt.steamCC),
                  fetchHistoricalLow(appId, opt.itadCountry),
                ]);
                return { code: opt.code, details, historicalLow };
              }),
            );

            const details = priceResults[0].details;
            const editionTemplates = extractEditionPrices(details);
            const editions: EditionInfo[] = editionTemplates.map((template) => {
              const editionPrices: Record<string, CurrencyPriceInfo> = {};
              for (const priceResult of priceResults) {
                const currEditions = extractEditionPrices(priceResult.details);
                const matching = currEditions.find((edition) => edition.packageId === template.packageId);
                if (matching) {
                  editionPrices[priceResult.code] = {
                    basePrice: priceResult.details.is_free ? 0 : matching.basePrice,
                    currentPrice: priceResult.details.is_free ? 0 : matching.currentPrice,
                    discountPercent: matching.discountPercent,
                    historicalLow: template.isStandard ? (priceResult.historicalLow?.price ?? null) : null,
                    historicalLowDate: template.isStandard ? (priceResult.historicalLow?.date ?? null) : null,
                  };
                }
              }

              return {
                name: template.name,
                displayName: template.displayName,
                packageId: template.packageId,
                isStandard: template.isStandard,
                prices: editionPrices,
              };
            });

            const standardEdition = editions.find((edition) => edition.isStandard) || editions[0];
            const prices: Record<string, CurrencyPriceInfo> = standardEdition?.prices ?? {};
            const gameName = details.name;

            send({ type: "progress", appId, appName: gameName, phase: "レビュー概要と言語別集計を取得中..." });

            const [reviewSummary, steamPurchaseReviews, currentPlayers, averagePlaytimeHours] = await Promise.all([
              fetchReviewSummary(appId),
              fetchSteamPurchaseReviewCount(appId),
              fetchCurrentPlayers(appId).catch(() => null),
              fetchReviewPlaytimeSample(appId).catch(() => null),
            ]);
            send({ type: "progress", appId, appName: gameName, phase: "言語別レビュー集計を取得中..." });
            const languageStats = await fetchLanguageStats(appId, reviewSummary);
            const releaseDate = details.release_date?.date || "不明";
            const releaseYear = parseReleaseYear(releaseDate);
            const positiveRate =
              reviewSummary.totalReviews > 0
                ? (reviewSummary.totalPositive / reviewSummary.totalReviews) * 100
                : 0;
            const usdPrice = prices.USD?.basePrice ?? (details.price_overview?.initial ?? 0) / 100;
            const defaultPrice = prices.JPY?.basePrice ?? Object.values(prices)[0]?.basePrice ?? 0;
            const marketEstimate = estimateSteamMarket({
              totalReviews: reviewSummary.totalReviews,
              steamPurchaseReviews,
              releaseYear,
              priceForMultiplier: usdPrice,
              basePriceForRevenue: defaultPrice,
              positiveRate,
              averagePlaytimeHours,
              isFree: details.is_free,
              currentPlayers,
            });
            const salesEstimate = salesEstimateFromMarket(marketEstimate);

            const result: GameAnalysis = {
              appId,
              name: gameName,
              headerImage: details.header_image,
              releaseDate,
              releaseYear,
              totalReviews: reviewSummary.totalReviews,
              steamPurchaseReviews,
              positiveReviews: reviewSummary.totalPositive,
              negativeReviews: reviewSummary.totalNegative,
              positiveRate,
              languageStats,
              salesEstimate,
              marketEstimate,
              currentPlayers,
              prices,
              editions,
              reviewSamples: [],
            };

            send({ type: "progress", appId, appName: gameName, phase: "分析結果を保存・整形中..." });
            await saveMetricSnapshot(result);
            send({ type: "result", data: result });
          } catch (err) {
            const message = err instanceof Error ? err.message : "不明なエラー";
            send({ type: "error", appId, message });
            console.error(`AppID ${appId} の分析エラー:`, err);
          }
        }

        send({ type: "done" });
      } finally {
        clearInterval(heartbeat);
        isClosed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
