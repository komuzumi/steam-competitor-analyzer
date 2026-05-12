import { GameAnalysis } from "@/types";
import { formatPrice, CurrencyCode } from "@/lib/currency";
import { estimateNetRevenue, estimateRevenue } from "@/lib/sales";

function formatNumber(n: number): string {
  return Math.round(n).toLocaleString("ja-JP");
}

function formatRange(standard: number, conservative: number, aggressive: number): string {
  return `${formatNumber(standard)} (${formatNumber(conservative)} - ${formatNumber(aggressive)})`;
}

export function generateMarkdownReport(results: GameAnalysis[], currency: CurrencyCode): string {
  const fp = (n: number) => formatPrice(n, currency);
  const lines: string[] = [];
  lines.push("# Steam 競合・市場分析レポート");
  lines.push(`生成日時: ${new Date().toLocaleString("ja-JP")}`);
  lines.push(`通貨: ${currency}`);
  lines.push("");

  if (results.length > 1) {
    lines.push("## 比較サマリー");
    lines.push("");
    lines.push("| タイトル | レビュー数 | 好評率 | 推定Steam販売本数(標準) | 総売上(標準) | 手数料控除後(標準) |");
    lines.push("|---|---:|---:|---:|---:|---:|");
    for (const result of results) {
      const gross = estimateRevenue(result.salesEstimate, result.prices[currency]?.basePrice ?? 0);
      const net = estimateNetRevenue(gross);
      lines.push(
        `| ${result.name} | ${formatNumber(result.totalReviews)} | ${result.positiveRate.toFixed(1)}% | ${formatNumber(result.salesEstimate.standard)} | ${fp(gross.standard)} | ${fp(net.standard)} |`,
      );
    }
    lines.push("");
  }

  for (const result of results) {
    const price = result.prices[currency];
    const gross = estimateRevenue(result.salesEstimate, price?.basePrice ?? 0);
    const net = estimateNetRevenue(gross);

    lines.push(`## ${result.name}`);
    lines.push("");
    lines.push(`- **AppID:** ${result.appId}`);
    lines.push(`- **発売日:** ${result.releaseDate}`);
    lines.push(`- **現在同時接続者:** ${result.currentPlayers == null ? "取得不可" : formatNumber(result.currentPlayers)}`);
    lines.push(`- **総レビュー数:** ${formatNumber(result.totalReviews)}`);
    lines.push(`- **Steam購入レビュー数:** ${formatNumber(result.steamPurchaseReviews)}`);
    lines.push(`- **好評率:** ${result.positiveRate.toFixed(1)}%`);
    lines.push(`- **推定信頼度:** ${result.marketEstimate.confidence}`);

    if (price) {
      lines.push(`- **定価:** ${fp(price.basePrice)}`);
      lines.push(`- **現在価格:** ${fp(price.currentPrice)}${price.discountPercent > 0 ? ` (-${price.discountPercent}%)` : ""}`);
      lines.push(
        `- **過去最安価格:** ${
          price.historicalLow !== null ? `${fp(price.historicalLow)}${price.historicalLowDate ? ` (${price.historicalLowDate})` : ""}` : "不明"
        }`,
      );
    }

    lines.push("");
    lines.push("### Stats");
    lines.push(`- **Copies sold:** ${formatRange(result.salesEstimate.standard, result.salesEstimate.conservative, result.salesEstimate.aggressive)}`);
    lines.push(
      `- **Gross revenue (base game):** ${fp(gross.standard)} (${fp(gross.conservative)} - ${fp(gross.aggressive)})`,
    );
    lines.push(
      `- **Players total:** ${formatRange(
        result.marketEstimate.standard.ownersEstimate,
        result.marketEstimate.conservative.ownersEstimate,
        result.marketEstimate.aggressive.ownersEstimate,
      )}`,
    );
    lines.push(
      `- **Owners:** ${formatRange(
        result.marketEstimate.standard.ownersEstimate,
        result.marketEstimate.conservative.ownersEstimate,
        result.marketEstimate.aggressive.ownersEstimate,
      )}`,
    );
    lines.push(`- **Reviews:** ${formatNumber(result.totalReviews)}`);
    lines.push(`- **Review score:** ${result.positiveRate.toFixed(1)}%`);
    lines.push(
      `- **Average playtime:** ${
        result.marketEstimate.explanation.averagePlaytimeHours == null
          ? "取得不可"
          : `${result.marketEstimate.explanation.averagePlaytimeHours.toFixed(1)}h`
      }`,
    );
    lines.push(
      `- **Copies sold in the last 7 days:** ${
        result.recentSalesEstimate
          ? `${result.recentSalesEstimate.isReviewCountCapped ? ">= " : ""}${formatRange(
              result.recentSalesEstimate.copiesSoldEstimate.standard,
              result.recentSalesEstimate.copiesSoldEstimate.conservative,
              result.recentSalesEstimate.copiesSoldEstimate.aggressive,
            )}`
          : "未取得"
      }`,
    );
    lines.push("- **Players by country:** レビュー言語ベースの簡易プロキシを画面側に表示");

    lines.push("");
    lines.push("### 推定販売本数・売上");
    lines.push("| ケース | 推定所有者 | 推定Steam販売本数 | 総売上 | 手数料控除後 |");
    lines.push("|---|---:|---:|---:|---:|");
    lines.push(
      `| 保守 | ${formatNumber(result.marketEstimate.conservative.ownersEstimate)} | ${formatNumber(result.salesEstimate.conservative)} | ${fp(gross.conservative)} | ${fp(net.conservative)} |`,
    );
    lines.push(
      `| 標準 | ${formatNumber(result.marketEstimate.standard.ownersEstimate)} | ${formatNumber(result.salesEstimate.standard)} | ${fp(gross.standard)} | ${fp(net.standard)} |`,
    );
    lines.push(
      `| 強気 | ${formatNumber(result.marketEstimate.aggressive.ownersEstimate)} | ${formatNumber(result.salesEstimate.aggressive)} | ${fp(gross.aggressive)} | ${fp(net.aggressive)} |`,
    );
    lines.push("");

    lines.push("### 推定ロジック");
    lines.push(`- 基準レビュー倍率: ${result.marketEstimate.explanation.baseReviewMultiplier} (${result.marketEstimate.explanation.ageFactorLabel})`);
    lines.push(`- 価格補正: x ${result.marketEstimate.explanation.priceFactor}`);
    lines.push(`- 好評率補正: x ${result.marketEstimate.explanation.reviewScoreFactor}`);
    lines.push(`- プレイ時間補正: x ${result.marketEstimate.explanation.playtimeFactor}`);
    lines.push(`- 最終レビュー倍率: ${result.marketEstimate.explanation.adjustedReviewMultiplier.toFixed(1)}`);
    lines.push(`- Steam購入レビュー比率: ${(result.marketEstimate.explanation.steamPurchaseReviewShare * 100).toFixed(1)}%`);
    lines.push(`- 使用データ: ${result.marketEstimate.explanation.usedData.join(" / ")}`);
    lines.push("");

    if (result.languageStats.length > 0) {
      lines.push("### 言語別レビュー");
      lines.push("| 言語 | レビュー数 | 好評 | 不評 | 好評率 |");
      lines.push("|---|---:|---:|---:|---:|");
      for (const lang of result.languageStats.slice(0, 15)) {
        const rate = lang.count > 0 ? (lang.positive / lang.count) * 100 : 0;
        lines.push(
          `| ${lang.displayName ?? lang.language} | ${formatNumber(lang.count)} | ${formatNumber(lang.positive)} | ${formatNumber(lang.negative)} | ${rate.toFixed(1)}% |`,
        );
      }
      lines.push("");
    }

    if (result.aiSummary) {
      lines.push("### AI分析レポート");
      lines.push("");
      lines.push("#### 高評価の理由");
      lines.push(result.aiSummary.positiveReasons);
      lines.push("");
      lines.push("#### 低評価の理由");
      lines.push(result.aiSummary.negativeReasons);
      lines.push("");
      lines.push("#### 頻出する不満");
      lines.push(result.aiSummary.frequentComplaints);
      lines.push("");
      lines.push("#### 企画に活かせる示唆");
      lines.push(result.aiSummary.planningInsights);
      lines.push("");
      lines.push("#### 海外展開時の注意点");
      lines.push(result.aiSummary.globalExpansionNotes);
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}
