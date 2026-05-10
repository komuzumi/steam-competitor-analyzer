import { NextRequest } from "next/server";
import {
  fetchAppDetails,
  fetchAllReviews,
  fetchSteamPurchaseReviewCount,
  aggregateByLanguage,
  parseReleaseYear,
  extractEditionPrices,
} from "@/lib/steam";
import { estimateSales } from "@/lib/sales";
import { summarizeReviews } from "@/lib/openai";
import { fetchHistoricalLow } from "@/lib/itad";
import { CURRENCY_OPTIONS } from "@/lib/currency";
import { GameAnalysis, CurrencyPriceInfo, EditionInfo, SSEEvent } from "@/types";

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { appIds, reviewLimit = 0 } = body as { appIds: string[]; reviewLimit?: number };

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
          // Phase 1: ストア情報・価格取得
          send({ type: "progress", appId, phase: "ストア情報を取得中..." });

          const priceResults = await Promise.all(
            CURRENCY_OPTIONS.map(async (opt) => {
              const [details, historicalLow] = await Promise.all([
                fetchAppDetails(appId, opt.steamCC),
                fetchHistoricalLow(appId, opt.itadCountry),
              ]);
              return { code: opt.code, details, historicalLow };
            })
          );

          const details = priceResults[0].details;

          // エディション別価格を構築
          const editionTemplates = extractEditionPrices(details);
          const editions: EditionInfo[] = editionTemplates.map(template => {
            const editionPrices: Record<string, CurrencyPriceInfo> = {};
            for (const pr of priceResults) {
              const currEditions = extractEditionPrices(pr.details);
              const matching = currEditions.find(e => e.packageId === template.packageId);
              if (matching) {
                editionPrices[pr.code] = {
                  basePrice: pr.details.is_free ? 0 : matching.basePrice,
                  currentPrice: pr.details.is_free ? 0 : matching.currentPrice,
                  discountPercent: matching.discountPercent,
                  historicalLow: template.isStandard ? (pr.historicalLow?.price ?? null) : null,
                  historicalLowDate: template.isStandard ? (pr.historicalLow?.date ?? null) : null,
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

          // 通常版の価格（売上推定・比較テーブル用）
          const standardEdition = editions.find(e => e.isStandard) || editions[0];
          const prices: Record<string, CurrencyPriceInfo> = standardEdition?.prices ?? {};
          const gameName = details.name;

          send({ type: "progress", appId, appName: gameName, phase: "ストア情報の取得完了" });

          // Phase 2: レビュー全件取得（進捗付き）
          send({ type: "progress", appId, appName: gameName, phase: "レビューを取得中...", detail: "0件取得済み" });

          const limitLabel = reviewLimit > 0 ? `最大${reviewLimit.toLocaleString()}件` : "全件";
          const reviewData = await fetchAllReviews(appId, (fetched, total) => {
            const target = reviewLimit > 0 ? Math.min(reviewLimit, total) : total;
            send({
              type: "progress",
              appId,
              appName: gameName,
              phase: `レビューを取得中...（${limitLabel}）`,
              detail: `${fetched.toLocaleString()} / ${target.toLocaleString()} 件`,
            });
          }, reviewLimit);

          send({
            type: "progress",
            appId,
            appName: gameName,
            phase: "レビュー取得完了",
            detail: `${reviewData.reviews.length.toLocaleString()} 件取得`,
          });

          // Phase 3: Steam購入レビュー数
          const steamPurchaseReviews = await fetchSteamPurchaseReviewCount(appId);

          // Phase 4: 集計
          const languageStats = aggregateByLanguage(reviewData.reviews);
          const releaseDate = details.release_date?.date || "不明";
          const releaseYear = parseReleaseYear(releaseDate);
          const positiveRate =
            reviewData.totalReviews > 0
              ? (reviewData.totalPositive / reviewData.totalReviews) * 100
              : 0;
          const salesEstimate = estimateSales(reviewData.totalReviews, releaseYear);
          const reviewSamples = reviewData.reviews.slice(0, 20).map((r) => ({
            text: r.review.slice(0, 500),
            language: r.language,
            votedUp: r.voted_up,
            playtime: Math.round(r.author.playtime_forever / 60),
          }));

          // Phase 5: AI要約
          let aiSummary;
          try {
            if (reviewData.reviews.length > 0) {
              send({ type: "progress", appId, appName: gameName, phase: "AI分析中..." });
              aiSummary = await summarizeReviews(gameName, reviewData.reviews);
              send({ type: "progress", appId, appName: gameName, phase: "AI分析完了" });
            }
          } catch (aiError) {
            console.error(`AI要約エラー (${appId}):`, aiError);
            send({ type: "progress", appId, appName: gameName, phase: "AI分析スキップ（APIエラー）" });
          }

          const result: GameAnalysis = {
            appId,
            name: gameName,
            headerImage: details.header_image,
            releaseDate,
            releaseYear,
            totalReviews: reviewData.totalReviews,
            steamPurchaseReviews,
            positiveReviews: reviewData.totalPositive,
            negativeReviews: reviewData.totalNegative,
            positiveRate,
            languageStats,
            salesEstimate,
            prices,
            editions,
            reviewSamples,
            aiSummary,
          };

          send({ type: "result", data: result });
        } catch (err) {
          const message = err instanceof Error ? err.message : "不明なエラー";
          send({ type: "error", appId, message });
          console.error(`AppID ${appId} のエラー:`, err);
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
