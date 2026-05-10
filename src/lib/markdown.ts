import { GameAnalysis } from "@/types";
import { formatPrice, CurrencyCode } from "@/lib/currency";
import { estimateRevenue } from "@/lib/sales";

function formatNumber(n: number): string {
  return n.toLocaleString("ja-JP");
}

export function generateMarkdownReport(results: GameAnalysis[], currency: CurrencyCode): string {
  const fp = (n: number) => formatPrice(n, currency);
  const lines: string[] = [];
  lines.push("# Steam 競合調査レポート");
  lines.push(`生成日時: ${new Date().toLocaleString("ja-JP")}`);
  lines.push(`通貨: ${currency}`);
  lines.push("");

  // 比較テーブル（複数タイトルの場合）
  if (results.length > 1) {
    lines.push("## 比較サマリー");
    lines.push("");
    lines.push(
      "| タイトル | 総レビュー数 | 好評率 | 仮説販売本数(標準) | 仮説売上(標準) |"
    );
    lines.push("|---|---|---|---|---|");
    for (const r of results) {
      const rev = estimateRevenue(r.salesEstimate, r.prices[currency]?.basePrice ?? 0);
      lines.push(
        `| ${r.name} | ${formatNumber(r.totalReviews)} | ${r.positiveRate.toFixed(1)}% | ${formatNumber(r.salesEstimate.standard)} | ${fp(rev.standard)} |`
      );
    }
    lines.push("");
  }

  // 各タイトル詳細
  for (const r of results) {
    const p = r.prices[currency];
    const rev = estimateRevenue(r.salesEstimate, p?.basePrice ?? 0);

    lines.push(`## ${r.name}`);
    lines.push("");
    lines.push(`- **AppID:** ${r.appId}`);
    lines.push(`- **発売日:** ${r.releaseDate}`);

    if (r.editions.length > 0) {
      lines.push("");
      lines.push("### 価格情報（エディション別）");
      lines.push("| エディション | 定価 | 現在価格 | 過去最低 |");
      lines.push("|---|---|---|---|");
      for (const edition of r.editions) {
        const ep = edition.prices[currency];
        if (!ep) continue;
        const currentCol = ep.discountPercent > 0
          ? `${fp(ep.currentPrice)} (-${ep.discountPercent}%)`
          : fp(ep.currentPrice);
        const lowCol = ep.historicalLow !== null ? fp(ep.historicalLow) : "---";
        lines.push(`| ${edition.displayName} | ${fp(ep.basePrice)} | ${currentCol} | ${lowCol} |`);
      }
    } else if (p) {
      lines.push(`- **定価:** ${fp(p.basePrice)}`);
      lines.push(`- **現在価格:** ${fp(p.currentPrice)}${p.discountPercent > 0 ? ` (-${p.discountPercent}%)` : ""}`);
      lines.push(`- **過去最低価格:** ${p.historicalLow !== null ? `${fp(p.historicalLow)}${p.historicalLowDate ? ` (${p.historicalLowDate})` : ""}` : "不明"}`);
    }
    lines.push(`- **総レビュー数:** ${formatNumber(r.totalReviews)}`);
    lines.push(`- **Steam購入レビュー数:** ${formatNumber(r.steamPurchaseReviews)}`);
    lines.push(`- **ポジティブ:** ${formatNumber(r.positiveReviews)}`);
    lines.push(`- **ネガティブ:** ${formatNumber(r.negativeReviews)}`);
    lines.push(`- **好評率:** ${r.positiveRate.toFixed(1)}%`);
    lines.push("");

    lines.push("### 仮説販売本数");
    lines.push("| ケース | 販売本数 | 売上 |");
    lines.push("|---|---|---|");
    lines.push(`| 保守 | ${formatNumber(r.salesEstimate.conservative)} | ${fp(rev.conservative)} |`);
    lines.push(`| 標準 | ${formatNumber(r.salesEstimate.standard)} | ${fp(rev.standard)} |`);
    lines.push(`| 強気 | ${formatNumber(r.salesEstimate.aggressive)} | ${fp(rev.aggressive)} |`);
    lines.push("");

    if (r.languageStats.length > 0) {
      lines.push("### 言語別レビュー数");
      lines.push("| 言語 | レビュー数 | ポジティブ | ネガティブ |");
      lines.push("|---|---|---|---|");
      for (const lang of r.languageStats.slice(0, 15)) {
        lines.push(
          `| ${lang.language} | ${lang.count} | ${lang.positive} | ${lang.negative} |`
        );
      }
      lines.push("");
    }

    if (r.aiSummary) {
      lines.push("### AI分析レポート");
      lines.push("");
      lines.push("#### 高評価の理由");
      lines.push(r.aiSummary.positiveReasons);
      lines.push("");
      lines.push("#### 低評価の理由");
      lines.push(r.aiSummary.negativeReasons);
      lines.push("");
      lines.push("#### 頻出する不満");
      lines.push(r.aiSummary.frequentComplaints);
      lines.push("");
      lines.push("#### 企画に活かせる示唆");
      lines.push(r.aiSummary.planningInsights);
      lines.push("");
      lines.push("#### 海外展開時の注意点");
      lines.push(r.aiSummary.globalExpansionNotes);
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}
