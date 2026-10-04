import { NextRequest } from "next/server";
import { fetchReviews, toPublicReview, STEAM_LANGUAGES } from "@/lib/steam";
import { apiSignal, protectApi } from "@/lib/api-protection";
import { collectReviewChunk } from "@/lib/review-chunks";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  return protectApi(req, "reviews", () => streamReviews(req));
}

async function streamReviews(req: NextRequest) {
  if (req.nextUrl.searchParams.get("chunked") !== "1") {
    return new Response(`${JSON.stringify({ type: "error", message: "アプリが更新されました。ページを再読み込みしてから全文レビューを取得してください。" })}\n`, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const appId = req.nextUrl.searchParams.get("appId");
  const language = req.nextUrl.searchParams.get("language") || "all";
  const cursor = req.nextUrl.searchParams.get("cursor") || "*";
  const rawType = req.nextUrl.searchParams.get("reviewType") || "all";
  const reviewType = rawType === "positive" || rawType === "negative" ? rawType : "all";
  const offset = Number(req.nextUrl.searchParams.get("offset") || 0);
  if (!appId || !/^\d{1,10}$/.test(appId) || cursor.length > 1024 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 100_000_000 ||
      (language !== "all" && !STEAM_LANGUAGES.some((item) => item.code === language))) {
    return Response.json({ error: "AppID、言語、取得位置の指定を確認してください。" }, { status: 400 });
  }
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const signal = apiSignal(controller.signal)!;
  let closed = false;
  const stream = new ReadableStream({
    async start(destination) {
      const send = (payload: unknown) => {
        if (!closed && !signal.aborted) destination.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };
      let fetched = offset;
      let total = 0;
      try {
        const result = await collectReviewChunk({
          cursor,
          signal,
          fetchPage: async (position) => {
            const page = await fetchReviews(appId, {
              cursor: position, filter: "recent", language, reviewType, numPerPage: 100, signal,
              onRetry: ({ delayMs }) => send({ type: "retry", message: `Steamの取得制限のため約${Math.ceil(delayMs / 1000)}秒待って再試行します。` }),
            });
            total = page.total_reviews || total;
            send({ type: "meta", total, language, reviewType });
            return { ...page, reviews: page.reviews.map(toPublicReview) };
          },
          pageBytes: (page) => page.reviews.reduce((sum, review) => sum + encoder.encode(JSON.stringify({ type: "review", review, fetched: fetched + 100, total })).byteLength + 1, 0),
          sendPage: (page) => {
            for (const review of page.reviews) {
              fetched++;
              send({ type: "review", review, fetched, total });
            }
            send({ type: "progress", fetched, total });
          },
        });
        send({ type: "done", fetched, total, complete: result.complete, nextCursor: result.cursor });
      } catch (error) {
        send({ type: "error", message: error instanceof Error ? error.message : "レビュー取得に失敗しました。" });
      } finally {
        if (!closed) { closed = true; destination.close(); }
      }
    },
    cancel() { closed = true; controller.abort(); },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}
