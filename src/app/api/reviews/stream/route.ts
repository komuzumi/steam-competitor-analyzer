import { NextRequest } from "next/server";
import { fetchReviews, toPublicReview } from "@/lib/steam";

export const maxDuration = 300;

type ReviewType = "all" | "positive" | "negative";

function parseReviewType(value: string | null): ReviewType {
  if (value === "positive" || value === "negative") return value;
  return "all";
}

export async function GET(req: NextRequest) {
  const appId = req.nextUrl.searchParams.get("appId");
  const language = req.nextUrl.searchParams.get("language") || "all";
  const reviewType = parseReviewType(req.nextUrl.searchParams.get("reviewType"));

  if (!appId || !/^\d+$/.test(appId)) {
    return new Response(JSON.stringify({ error: "AppIDを指定してください" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (payload: unknown) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      };

      try {
        let cursor = "*";
        let fetched = 0;
        let total = 0;
        const seenCursors = new Set<string>();

        while (true) {
          const result = await fetchReviews(appId, {
            cursor,
            filter: "recent",
            language,
            reviewType,
            numPerPage: 100,
          });

          if (fetched === 0) {
            total = result.total_reviews;
            send({ type: "meta", total, language, reviewType });
          }

          for (const review of result.reviews) {
            fetched++;
            send({ type: "review", review: toPublicReview(review), fetched, total });
          }

          cursor = result.cursor;
          send({ type: "progress", fetched, total });

          if (!result.reviews.length) break;
          if (total > 0 && fetched >= total) break;
          if (!cursor || cursor === "*" || seenCursors.has(cursor)) break;

          seenCursors.add(cursor);
          await new Promise((resolve) => setTimeout(resolve, 300));
        }

        send({ type: "done", fetched, total });
      } catch (err) {
        const message = err instanceof Error ? err.message : "レビュー取得に失敗しました";
        send({ type: "error", message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
