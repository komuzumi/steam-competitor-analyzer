import { NextRequest } from "next/server";
import { fetchReviews, toPublicReview } from "@/lib/steam";

export const maxDuration = 300;

function csvEscape(value: string | number | boolean | undefined): string {
  const text = String(value ?? "");
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function csvRow(values: Array<string | number | boolean | undefined>): string {
  return `${values.map(csvEscape).join(",")}\r\n`;
}

function safeFilename(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120);
}

function contentDisposition(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(req: NextRequest) {
  const appId = req.nextUrl.searchParams.get("appId");
  const name = req.nextUrl.searchParams.get("name") || appId || "steam-reviews";
  const language = req.nextUrl.searchParams.get("language") || "all";

  if (!appId || !/^\d+$/.test(appId)) {
    return new Response(JSON.stringify({ error: "AppIDを指定してください" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const write = (text: string) => controller.enqueue(encoder.encode(text));

      try {
        write(
          csvRow([
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
          ]),
        );

        let cursor = "*";
        let fetched = 0;
        let total = 0;
        const seenCursors = new Set<string>();

        while (true) {
          const result = await fetchReviews(appId, {
            cursor,
            filter: "recent",
            language,
            numPerPage: 100,
          });

          if (fetched === 0) total = result.total_reviews;

          for (const rawReview of result.reviews) {
            const review = toPublicReview(rawReview);
            fetched++;
            write(
              csvRow([
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
              ]),
            );
          }

          cursor = result.cursor;
          if (!result.reviews.length) break;
          if (total > 0 && fetched >= total) break;
          if (!cursor || cursor === "*" || seenCursors.has(cursor)) break;

          seenCursors.add(cursor);
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "CSV generation failed";
        write(csvRow(["ERROR", message]));
      } finally {
        controller.close();
      }
    },
  });

  const suffix = language === "all" ? "reviews" : `${language}-reviews`;
  const filename = `${appId}-${safeFilename(name)}-${suffix}.csv`;

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": contentDisposition(filename),
      "Cache-Control": "no-store",
    },
  });
}
