import { NextRequest } from "next/server";
import { fetchSteamDiscoveryList } from "@/lib/steam";
import { DiscoveryMarket, DiscoveryResponse } from "@/types";

export const maxDuration = 60;

function normalizeMarket(value: string | null): DiscoveryMarket {
  return value === "global" ? "global" : "jp";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Steam候補の取得に失敗しました。";
}

export async function GET(req: NextRequest) {
  const market = normalizeMarket(req.nextUrl.searchParams.get("market"));
  const [topSellersResult, newReleasesResult] = await Promise.allSettled([
    fetchSteamDiscoveryList("top_sellers", market),
    fetchSteamDiscoveryList("new_releases", market),
  ]);

  const errors: DiscoveryResponse["errors"] = {};
  if (topSellersResult.status === "rejected") {
    errors.topSellers = errorMessage(topSellersResult.reason);
  }
  if (newReleasesResult.status === "rejected") {
    errors.newReleases = errorMessage(newReleasesResult.reason);
  }

  const response: DiscoveryResponse = {
    market,
    generatedAt: new Date().toISOString(),
    topSellers: topSellersResult.status === "fulfilled" ? topSellersResult.value : [],
    newReleases: newReleasesResult.status === "fulfilled" ? newReleasesResult.value : [],
    notes: [
      "Steam公開検索ページから取得したリサーチ候補です。",
      "レビュー、AI分析、ITAD、DB保存はこの候補表示では実行しません。",
    ],
    errors: Object.keys(errors).length ? errors : undefined,
  };

  return new Response(JSON.stringify(response), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "s-maxage=300, stale-while-revalidate=600",
    },
  });
}
