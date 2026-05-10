// IsThereAnyDeal API v2 連携

interface ITADHistoricalLow {
  price: number;
  date: string;
}

export async function fetchHistoricalLow(appId: string, country: string = "JP"): Promise<ITADHistoricalLow | null> {
  const apiKey = process.env.ITAD_API_KEY;
  if (!apiKey) {
    return null;
  }

  try {
    // Step 1: Steam AppIDからITADのゲームIDを取得
    const lookupRes = await fetch(
      `https://api.isthereanydeal.com/games/lookup/v1?key=${encodeURIComponent(apiKey)}&appid=${appId}`
    );

    if (!lookupRes.ok) return null;

    const lookupData = await lookupRes.json();
    const gameId = lookupData?.game?.id;
    if (!gameId) return null;

    // Step 2: 過去最低価格を取得
    const lowRes = await fetch(
      `https://api.isthereanydeal.com/games/storelow/v2?key=${encodeURIComponent(apiKey)}&country=${country}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([gameId]),
      }
    );

    if (!lowRes.ok) return null;

    const lowData = await lowRes.json();
    const entry = Array.isArray(lowData) ? lowData.find((e: { id: string }) => e.id === gameId) : null;
    if (!entry?.lows?.length) return null;

    // Steamのエントリを優先、なければ全ショップ最安
    const steamLow = entry.lows.find((l: { shop: { name: string } }) => l.shop?.name === "Steam");
    const best = steamLow || entry.lows[0];

    const raw: string = best.timestamp ?? "";
    const dateOnly = raw.includes("T") ? raw.split("T")[0] : raw;

    return {
      price: best.price?.amount ?? 0,
      date: dateOnly,
    };
  } catch {
    return null;
  }
}
