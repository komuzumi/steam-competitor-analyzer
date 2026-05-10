import { GoogleGenerativeAI } from "@google/generative-ai";
import { AISummaryResult, PublicReview, SteamReview } from "@/types";

function getModel() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY が設定されていません。.env.local を確認してください。");
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
  return `あなたはゲーム業界のアナリストです。Steamゲーム「${gameName}」のユーザーレビューを分析してください。

以下のレビュー情報は「${corpusLabel}」です。日本語で、競合調査・企画判断に使える具体性を優先してください。

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

function safeParseSummary(content: string): AISummaryResult {
  try {
    return JSON.parse(content) as AISummaryResult;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Gemini API のJSONレスポンスを解析できませんでした");
    return JSON.parse(match[0]) as AISummaryResult;
  }
}

export async function summarizeReviews(gameName: string, reviews: SteamReview[]): Promise<AISummaryResult> {
  const positiveReviews = reviews.filter((review) => review.voted_up).slice(0, 80);
  const negativeReviews = reviews.filter((review) => !review.voted_up).slice(0, 80);
  const corpus = [
    "## Positive reviews",
    positiveReviews.map(formatReview).join("\n---\n"),
    "## Negative reviews",
    negativeReviews.map(formatReview).join("\n---\n"),
  ].join("\n\n");

  return summarizeReviewCorpus(gameName, corpus, `Steam helpfulness order sample (${reviews.length} reviews)`);
}

export async function summarizeReviewCorpus(
  gameName: string,
  reviewCorpus: string,
  corpusLabel: string,
): Promise<AISummaryResult> {
  const model = getModel();
  const result = await model.generateContent(buildPrompt(gameName, reviewCorpus, corpusLabel));
  const content = result.response.text();

  if (!content) {
    throw new Error("Gemini API から空のレスポンスが返りました");
  }

  return safeParseSummary(content);
}
