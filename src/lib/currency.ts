export type CurrencyCode = "JPY" | "USD" | "EUR" | "SGD";

export interface CurrencyOption {
  code: CurrencyCode;
  label: string;
  symbol: string;
  steamCC: string; // Steam API cc parameter
  itadCountry: string; // ITAD API country code
  decimals: number;
}

export const CURRENCY_OPTIONS: CurrencyOption[] = [
  { code: "JPY", label: "日本円 (JPY)", symbol: "¥", steamCC: "jp", itadCountry: "JP", decimals: 0 },
  { code: "USD", label: "米ドル (USD)", symbol: "$", steamCC: "us", itadCountry: "US", decimals: 2 },
  { code: "EUR", label: "ユーロ (EUR)", symbol: "€", steamCC: "de", itadCountry: "DE", decimals: 2 },
  { code: "SGD", label: "シンガポールドル (SGD)", symbol: "S$", steamCC: "sg", itadCountry: "SG", decimals: 2 },
];

export function getCurrencyOption(code: CurrencyCode): CurrencyOption {
  return CURRENCY_OPTIONS.find((c) => c.code === code) || CURRENCY_OPTIONS[0];
}

export function formatPrice(amount: number, code: CurrencyCode): string {
  const opt = getCurrencyOption(code);
  const formatted = amount.toLocaleString("ja-JP", {
    minimumFractionDigits: opt.decimals,
    maximumFractionDigits: opt.decimals,
  });
  return `${opt.symbol}${formatted}`;
}
