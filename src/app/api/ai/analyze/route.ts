import { NextRequest } from "next/server";
import { summarizeReviewCorpus, summarizeReviews } from "@/lib/openai";
import { fetchRepresentativeReviews, getLanguageDisplayName } from "@/lib/steam";

export const maxDuration = 300;
const REVIEW_FETCH_TIMEOUT_MS = 60_000;
const GEMINI_TIMEOUT_MS = 90_000;

type RequestBody =
  | {
      appId: string;
      gameName: string;
      mode: "representative";
      language?: string;
      geminiApiKey?: string;
    }
  | {
      appId: string;
      gameName: string;
      mode: "full_compressed";
      language?: string;
      corpus: string;
      geminiApiKey?: string;
    };

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label}がタイムアウトしました。時間を置いてもう一度試してください。`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as RequestBody;
    if (!body.appId || !/^\d+$/.test(body.appId) || !body.gameName) {
      return new Response(JSON.stringify({ error: "AppIDとタイトル名を指定してください" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const language = body.language || "all";
    const languageLabel = language === "all" ? "全言語" : getLanguageDisplayName(language);

    if (body.mode === "representative") {
      const reviews = await withTimeout(
        fetchRepresentativeReviews(body.appId, 200, language),
        "代表レビュー取得",
        REVIEW_FETCH_TIMEOUT_MS,
      );
      const aiSummary = await withTimeout(
        summarizeReviews(body.gameName, reviews, body.geminiApiKey),
        "Gemini分析",
        GEMINI_TIMEOUT_MS,
      );
      return Response.json({
        aiSummary,
        reviewCount: reviews.length,
        language,
        selectionNote: `${languageLabel}の直近365日レビューから、好評/不評を混ぜて最大200件を抽出しました。`,
      });
    }

    if (body.mode === "full_compressed") {
      if (!body.corpus || body.corpus.length < 100) {
        return new Response(JSON.stringify({ error: "AI分析用のレビュー要約が不足しています" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const aiSummary = await withTimeout(
        summarizeReviewCorpus(
          body.gameName,
          body.corpus,
          `${languageLabel}の全文レビュー圧縮コーパス`,
          body.geminiApiKey,
        ),
        "Gemini分析",
        GEMINI_TIMEOUT_MS,
      );
      return Response.json({ aiSummary, language });
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
