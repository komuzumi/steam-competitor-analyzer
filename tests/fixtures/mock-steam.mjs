// Explicit test-only preload. This file is excluded from the deployment container.
const originalFetch = globalThis.fetch;
const total = 13_050;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === "generativelanguage.googleapis.com") throw new Error("Gemini must not be called in this test");
  if (url.hostname === "api.isthereanydeal.com") return Response.json({});
  if (url.hostname === "api.steampowered.com") return Response.json({ response: { player_count: 100 } });
  if (url.hostname !== "store.steampowered.com") return originalFetch(input, init);
  init?.signal?.throwIfAborted();
  if (url.pathname === "/api/appdetails") {
    const appId = url.searchParams.get("appids");
    return Response.json({ [appId]: { success: true, data: {
      name: "動作確認用タイトル（13,050件）", is_free: false,
      header_image: "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/620/header.jpg",
      release_date: { date: "Apr 19, 2011" },
      price_overview: { initial: 1000, final: 1000, discount_percent: 0, currency: "USD" },
      genres: [{ id: "1", description: "Action" }],
    } } });
  }
  if (url.pathname.startsWith("/appreviews/")) {
    const language = url.searchParams.get("language");
    const count = language === "all" || language === "japanese" ? total : 0;
    const rawCursor = url.searchParams.get("cursor") ?? "*";
    const start = rawCursor === "*" ? 0 : Number(rawCursor);
    const limit = Number(url.searchParams.get("num_per_page") ?? 100);
    const size = Math.max(0, Math.min(limit, count - start));
    const reviews = Array.from({ length: size }, (_, i) => ({
      recommendationid: String(start + i), language: "japanese", voted_up: (start + i) % 10 !== 0,
      review: `検証レビュー ${start + i}。最後まで欠落なく取得できることを確認します。`,
      author: { steamid: String(100000 + start + i), playtime_forever: 600, playtime_at_review: 300 },
      timestamp_created: Math.floor(Date.now() / 1000) - 3600, timestamp_updated: Math.floor(Date.now() / 1000),
      votes_up: 1, weighted_vote_score: "0.8",
    }));
    return Response.json({ success: 1, reviews, cursor: String(start + size), query_summary: {
      total_reviews: count, total_positive: Math.round(count * 0.9), total_negative: count - Math.round(count * 0.9),
    } });
  }
  return new Response("");
};
