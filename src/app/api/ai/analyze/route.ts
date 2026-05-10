import { NextRequest } from "next/server";
import { summarizeReviewCorpus, summarizeReviews } from "@/lib/openai";
import { fetchRepresentativeReviews } from "@/lib/steam";

export const maxDuration = 300;

type RequestBody =
  | {
      appId: string;
      gameName: string;
      mode: "representative";
    }
  | {
      appId: string;
      gameName: string;
      mode: "full_compressed";
      corpus: string;
    };

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RequestBody;
    if (!body.appId || !/^\d+$/.test(body.appId) || !body.gameName) {
      return new Response(JSON.stringify({ error: "AppIDとタイトル名を指定してください" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (body.mode === "representative") {
      const reviews = await fetchRepresentativeReviews(body.appId, 200);
      const aiSummary = await summarizeReviews(body.gameName, reviews);
      return Response.json({ aiSummary, reviewCount: reviews.length });
    }

    if (body.mode === "full_compressed") {
      if (!body.corpus || body.corpus.length < 100) {
        return new Response(JSON.stringify({ error: "AI分析用のレビュー要約が不足しています" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const aiSummary = await summarizeReviewCorpus(body.gameName, body.corpus, "full review compressed corpus");
      return Response.json({ aiSummary });
    }

    return new Response(JSON.stringify({ error: "未対応のAI分析モードです" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "AI分析に失敗しました";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
