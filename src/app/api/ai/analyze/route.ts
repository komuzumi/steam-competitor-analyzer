import { NextRequest } from "next/server";
import { summarizeReviewCorpus, summarizeReviews } from "@/lib/openai";
import { fetchRepresentativeReviews, getLanguageDisplayName } from "@/lib/steam";
import { AISampleMeta, SteamReview } from "@/types";
import { ApiLimitError, apiErrorResponse, protectApi, readLimitedJson } from "@/lib/api-protection";

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

function buildRepresentativeSampleMeta(
  reviews: SteamReview[],
  language: string,
  languageLabel: string,
): AISampleMeta {
  const positiveCount = reviews.filter((review) => review.voted_up).length;
  const negativeCount = reviews.length - positiveCount;
  const playtimes = reviews
    .map((review) => review.author?.playtime_forever ?? 0)
    .filter((minutes) => minutes > 0);
  const timestamps = reviews
    .map((review) => review.timestamp_created)
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0)
    .sort((a, b) => a - b);
  const languageCounts = new Map<string, number>();

  for (const review of reviews) {
    languageCounts.set(review.language, (languageCounts.get(review.language) ?? 0) + 1);
  }

  return {
    mode: "representative",
    language,
    languageLabel,
    reviewCount: reviews.length,
    positiveCount,
    negativeCount,
    positiveRate: reviews.length > 0 ? (positiveCount / reviews.length) * 100 : 0,
    averagePlaytimeHours:
      playtimes.length > 0 ? playtimes.reduce((sum, minutes) => sum + minutes, 0) / playtimes.length / 60 : null,
    oldestReviewDate:
      timestamps.length > 0 ? new Date(timestamps[0] * 1000).toISOString().slice(0, 10) : null,
    newestReviewDate:
      timestamps.length > 0 ? new Date(timestamps[timestamps.length - 1] * 1000).toISOString().slice(0, 10) : null,
    topLanguages: Array.from(languageCounts.entries())
      .map(([reviewLanguage, count]) => ({ language: reviewLanguage, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    selectionRule:
      "直近365日のレビューから、好評/不評を混ぜて最大200件を抽出。weighted_vote_score、参考票数、投稿日時を優先します。不評がある場合は最低25%を目安に確保します。",
  };
}

export async function POST(req: NextRequest) {
  return protectApi(req, "ai", () => analyzeAi(req));
}

async function analyzeAi(req: NextRequest) {
  try {
    const body = await readLimitedJson<RequestBody>(req, 512 * 1024);
    if (!body || typeof body !== "object" || typeof body.appId !== "string" || !/^\d{1,10}$/.test(body.appId) ||
        typeof body.gameName !== "string" || !body.gameName || body.gameName.length > 300 ||
        (body.geminiApiKey !== undefined && (typeof body.geminiApiKey !== "string" || body.geminiApiKey.length > 256)) ||
        (body.language !== undefined && (typeof body.language !== "string" || !/^[a-z]{2,20}$/.test(body.language)))) {
      return new Response(JSON.stringify({ error: "AppIDとタイトル名を指定してください" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const geminiApiKey = body.geminiApiKey?.trim();
    if (!geminiApiKey) {
      return new Response(
        JSON.stringify({
          error: "Gemini APIキーを入力してください。キーはAI分析時だけ送信され、サーバーには保存されません。",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
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
        summarizeReviews(body.gameName, reviews, geminiApiKey),
        "Gemini分析",
        GEMINI_TIMEOUT_MS,
      );
      const sampleMeta = buildRepresentativeSampleMeta(reviews, language, languageLabel);
      return Response.json({
        aiSummary,
        reviewCount: reviews.length,
        language,
        sampleMeta,
        selectionNote: `${languageLabel}の直近365日レビューから、好評/不評を混ぜて最大200件を抽出しました。`,
      });
    }

    if (body.mode === "full_compressed") {
      if (typeof body.corpus !== "string" || body.corpus.length < 100 || body.corpus.length > 160_000) {
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
          geminiApiKey,
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
    if (err instanceof ApiLimitError) return apiErrorResponse(err);
    // SDK errors can contain request URLs or credentials. Never echo them verbatim.
    const message = err instanceof Error && err.message.includes("タイムアウト")
      ? "AI分析がタイムアウトしました。時間を置いてもう一度試してください。"
      : "AI分析に失敗しました。Gemini APIキーと利用上限を確認して、時間を置いて再実行してください。";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
