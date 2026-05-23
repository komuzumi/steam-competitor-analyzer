import { NextRequest, NextResponse } from "next/server";
import { buildAudienceOverlap } from "@/lib/audienceOverlap";
import { CURRENCY_OPTIONS, CurrencyCode } from "@/lib/currency";
import { AudienceOverlapSampleMode } from "@/types";

export const maxDuration = 300;

function isCurrencyCode(value: string | null): value is CurrencyCode {
  return Boolean(value && CURRENCY_OPTIONS.some((option) => option.code === value));
}

function isSampleMode(value: string | null): value is AudienceOverlapSampleMode {
  return value === "standard" || value === "high";
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const appId = searchParams.get("appId");
  const currencyParam = searchParams.get("currency");
  const sampleModeParam = searchParams.get("sampleMode");

  if (!appId || !/^\d+$/.test(appId)) {
    return NextResponse.json({ error: "AppIDを指定してください。" }, { status: 400 });
  }

  const currency = isCurrencyCode(currencyParam) ? currencyParam : "JPY";
  const sampleMode = isSampleMode(sampleModeParam) ? sampleModeParam : "standard";

  try {
    const result = await buildAudienceOverlap({ appId, currency, sampleMode });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "類似タイトル分析に失敗しました。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
