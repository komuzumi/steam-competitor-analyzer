import { GameAnalysis } from "@/types";

interface MetricSnapshotPayload {
  app_id: string;
  name: string;
  captured_at: string;
  base_price: number | null;
  current_price: number | null;
  review_count: number;
  steam_purchase_review_count: number;
  positive_rate: number;
  language_stats: unknown;
  current_players: number | null;
  estimated_owners: number;
  estimated_steam_copies_sold: number;
  gross_revenue: number;
  net_revenue_after_steam_fee: number;
  confidence: string;
}

function getSupabaseConfig(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

export async function saveMetricSnapshot(analysis: GameAnalysis, defaultCurrency: string = "JPY"): Promise<void> {
  const config = getSupabaseConfig();
  if (!config) return;

  const price = analysis.prices[defaultCurrency] ?? Object.values(analysis.prices)[0];
  const payload: MetricSnapshotPayload = {
    app_id: analysis.appId,
    name: analysis.name,
    captured_at: new Date().toISOString(),
    base_price: price?.basePrice ?? null,
    current_price: price?.currentPrice ?? null,
    review_count: analysis.totalReviews,
    steam_purchase_review_count: analysis.steamPurchaseReviews,
    positive_rate: analysis.positiveRate,
    language_stats: analysis.languageStats.map((stat) => ({
      language: stat.language,
      displayName: stat.displayName,
      count: stat.count,
      positive: stat.positive,
      negative: stat.negative,
    })),
    current_players: analysis.currentPlayers,
    estimated_owners: analysis.marketEstimate.standard.ownersEstimate,
    estimated_steam_copies_sold: analysis.marketEstimate.standard.steamCopiesSoldEstimate,
    gross_revenue: analysis.marketEstimate.standard.grossRevenueEstimate,
    net_revenue_after_steam_fee: analysis.marketEstimate.standard.netRevenueAfterSteamFee,
    confidence: analysis.marketEstimate.confidence,
  };

  try {
    const res = await fetch(`${config.url}/rest/v1/game_metric_snapshots`, {
      method: "POST",
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.warn(`Metric snapshot was not saved: ${res.status}`);
    }
  } catch (err) {
    console.warn("Metric snapshot was not saved", err);
  }
}
