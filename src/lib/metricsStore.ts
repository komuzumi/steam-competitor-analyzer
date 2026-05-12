import { ConcurrentPlayersHistory, GameAnalysis } from "@/types";

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

interface CcuSnapshotRow {
  captured_at: string;
  current_players: number | null;
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

export async function fetchConcurrentPlayersHistory(
  appId: string,
  periodDays: number = 30,
): Promise<ConcurrentPlayersHistory | null> {
  const config = getSupabaseConfig();
  if (!config) return null;

  const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    select: "captured_at,current_players",
    app_id: `eq.${appId}`,
    captured_at: `gte.${since}`,
    current_players: "not.is.null",
    order: "captured_at.asc",
  });

  try {
    const res = await fetch(`${config.url}/rest/v1/game_metric_snapshots?${params}`, {
      headers: {
        apikey: config.key,
        Authorization: `Bearer ${config.key}`,
      },
    });

    if (!res.ok) {
      console.warn(`Concurrent player history was not loaded: ${res.status}`);
      return null;
    }

    const rows = ((await res.json()) as CcuSnapshotRow[]).filter(
      (row) => row.current_players != null && Number.isFinite(row.current_players),
    );
    if (!rows.length) {
      return {
        periodDays,
        capturedDays: 0,
        sampleCount: 0,
        averageDailyPlayers: null,
        firstCapturedAt: null,
        lastCapturedAt: null,
        hasEnoughHistory: false,
      };
    }

    const dailyBuckets = new Map<string, number[]>();
    for (const row of rows) {
      const day = row.captured_at.slice(0, 10);
      const bucket = dailyBuckets.get(day) ?? [];
      bucket.push(row.current_players ?? 0);
      dailyBuckets.set(day, bucket);
    }

    const dailyAverages = Array.from(dailyBuckets.values()).map(
      (values) => values.reduce((sum, value) => sum + value, 0) / values.length,
    );
    const averageDailyPlayers =
      dailyAverages.length > 0
        ? Math.round(dailyAverages.reduce((sum, value) => sum + value, 0) / dailyAverages.length)
        : null;

    return {
      periodDays,
      capturedDays: dailyBuckets.size,
      sampleCount: rows.length,
      averageDailyPlayers,
      firstCapturedAt: rows[0]?.captured_at ?? null,
      lastCapturedAt: rows.at(-1)?.captured_at ?? null,
      hasEnoughHistory: dailyBuckets.size >= periodDays,
    };
  } catch (err) {
    console.warn("Concurrent player history was not loaded", err);
    return null;
  }
}
