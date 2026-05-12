import { GoogleGenerativeAI } from "@google/generative-ai";
import { AISummaryResult, PublicReview, SteamReview } from "@/types";

function getModel(apiKeyOverride?: string) {
  const apiKey = apiKeyOverride?.trim() || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini APIキーが設定されていません。AI分析パネルでAPIキーを入力してください。");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
    },
  });
}

function formatReview(review: SteamReview | PublicReview): string {
  const playtime =
    "author" in review
      ? Math.round((review.author?.playtime_forever ?? 0) / 60)
      : Math.round(review.playtime_forever / 60);
  const votesUp = Number(review.votes_up ?? 0);
  return `[${review.language}] (${review.voted_up ? "positive" : "negative"}, playtime: ${playtime}h, helpful: ${votesUp}) ${review.review.slice(0, 350)}`;
}

function buildPrompt(gameName: string, reviewCorpus: string, corpusLabel: string): string {
  return `あなたはゲーム業界の市場分析担当です。Steamゲーム「${gameName}」のユーザーレビューを分析してください。

レビュー情報は「${corpusLabel}」です。日本語で、競合調査・企画判断に使える具体性を優先してください。

## レビュー情報
${reviewCorpus}

必ずJSONのみで返してください。Markdownやコードブロックは不要です。
{
  "positiveReasons": "高評価の主な理由。箇条書きで3-5点。",
  "negativeReasons": "低評価の主な理由。箇条書きで3-5点。",
  "frequentComplaints": "頻出する不満点。箇条書きで3-5点。",
  "planningInsights": "ゲーム企画・改善に活かせる示唆。箇条書きで3-5点。",
  "globalExpansionNotes": "海外展開・ローカライズ面の注意点。箇条書きで3-5点。"
}`;
}

function normalizeSummaryField(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => String(item)).join("\n");
  if (typeof value === "string") return value;
  if (value == null) return "";
  return String(value);
}

function normalizeSummary(value: unknown): AISummaryResult {
  const raw = value as Partial<Record<keyof AISummaryResult, unknown>>;
  return {
    positiveReasons: normalizeSummaryField(raw.positiveReasons),
    negativeReasons: normalizeSummaryField(raw.negativeReasons),
    frequentComplaints: normalizeSummaryField(raw.frequentComplaints),
    planningInsights: normalizeSummaryField(raw.planningInsights),
    globalExpansionNotes: normalizeSummaryField(raw.globalExpansionNotes),
  };
}

function safeParseSummary(content: string): AISummaryResult {
  try {
    return normalizeSummary(JSON.parse(content));
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Gemini APIのJSONレスポンスを解析できませんでした");
    return normalizeSummary(JSON.parse(match[0]));
  }
}

export async function summarizeReviews(
  gameName: string,
  reviews: SteamReview[],
  apiKey?: string,
): Promise<AISummaryResult> {
  const positiveReviews = reviews.filter((review) => review.voted_up).slice(0, 120);
  const negativeReviews = reviews.filter((review) => !review.voted_up).slice(0, 80);
  const corpus = [
    "## Positive reviews",
    positiveReviews.map(formatReview).join("\n---\n"),
    "## Negative reviews",
    negativeReviews.map(formatReview).join("\n---\n"),
  ].join("\n\n");

  return summarizeReviewCorpus(gameName, corpus, `代表レビューサンプル（${reviews.length}件）`, apiKey);
}

export async function summarizeReviewCorpus(
  gameName: string,
  reviewCorpus: string,
  corpusLabel: string,
  apiKey?: string,
): Promise<AISummaryResult> {
  const model = getModel(apiKey);
  const result = await model.generateContent(buildPrompt(gameName, reviewCorpus, corpusLabel));
  const content = result.response.text();

  if (!content) {
    throw new Error("Gemini APIから空のレスポンスが返りました");
  }

  return safeParseSummary(content);
}
