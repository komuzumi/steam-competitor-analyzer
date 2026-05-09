import { GoogleGenerativeAI } from "@google/generative-ai";
import { AISummaryResult, SteamReview } from "@/types";

export async function summarizeReviews(
  gameName: string,
  reviews: SteamReview[]
): Promise<AISummaryResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEYが設定されていません。.env.localを確認してください。");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: {
      temperature: 0.3,
      responseMimeType: "application/json",
    },
  });

  // レビューをポジティブ・ネガティブに分ける
  const positiveReviews = reviews.filter((r) => r.voted_up).slice(0, 30);
  const negativeReviews = reviews.filter((r) => !r.voted_up).slice(0, 30);

  const formatReviews = (revs: SteamReview[]) =>
    revs
      .map(
        (r) =>
          `[${r.language}] (プレイ時間: ${Math.round(r.author.playtime_forever / 60)}時間) ${r.review.slice(0, 300)}`
      )
      .join("\n---\n");

  const prompt = `あなたはゲーム業界のアナリストです。以下はSteamゲーム「${gameName}」のユーザーレビューです。
これらのレビューを分析し、日本語で以下の5項目をまとめてください。

## 高評価レビュー:
${formatReviews(positiveReviews)}

## 低評価レビュー:
${formatReviews(negativeReviews)}

以下の形式でJSON形式で出力してください（必ずJSON形式で、余計なテキストは含めないでください）:
{
  "positiveReasons": "高評価の主な理由（箇条書きで3-5点）",
  "negativeReasons": "低評価の主な理由（箇条書きで3-5点）",
  "frequentComplaints": "頻出する不満点（箇条書きで3-5点）",
  "planningInsights": "ゲーム企画に活かせる示唆（箇条書きで3-5点）",
  "globalExpansionNotes": "海外展開時の注意点（箇条書きで3-5点）"
}`;

  const result = await model.generateContent(prompt);
  const content = result.response.text();

  if (!content) {
    throw new Error("Gemini APIからの応答が空です");
  }

  return JSON.parse(content) as AISummaryResult;
}
