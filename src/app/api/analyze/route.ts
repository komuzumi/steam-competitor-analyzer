import { NextRequest } from "next/server";
import {
  extractEditionPrices,
  fetchAppDetails,
  fetchLanguageStats,
  fetchReviewSummary,
  fetchSteamPurchaseReviewCount,
  parseReleaseYear,
} from "@/lib/steam";
import { estimateSales } from "@/lib/sales";
import { fetchHistoricalLow } from "@/lib/itad";
import { CURRENCY_OPTIONS } from "@/lib/currency";
import { CurrencyPriceInfo, EditionInfo, GameAnalysis, SSEEvent } from "@/types";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { appIds } = body as { appIds: string[] };

  if (!appIds || !Array.isArray(appIds) || appIds.length === 0 || appIds.length > 5) {
    return new Response(JSON.stringify({ error: "AppIDは1〜5件で指定してください" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(event: SSEEvent) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

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

          const [reviewSummary, steamPurchaseReviews] = await Promise.all([
            fetchReviewSummary(appId),
            fetchSteamPurchaseReviewCount(appId),
          ]);
          const languageStats = await fetchLanguageStats(appId, reviewSummary);
          const releaseDate = details.release_date?.date || "不明";
          const releaseYear = parseReleaseYear(releaseDate);
          const positiveRate =
            reviewSummary.totalReviews > 0
              ? (reviewSummary.totalPositive / reviewSummary.totalReviews) * 100
              : 0;
          const salesEstimate = estimateSales(reviewSummary.totalReviews, releaseYear);

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
            prices,
            editions,
            reviewSamples: [],
          };

          send({ type: "result", data: result });
        } catch (err) {
          const message = err instanceof Error ? err.message : "不明なエラー";
          send({ type: "error", appId, message });
          console.error(`AppID ${appId} の分析エラー:`, err);
        }
      }

      send({ type: "done" });
      controller.close();
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
