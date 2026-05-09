"use client";

import { CURRENCY_OPTIONS, CurrencyCode } from "@/lib/currency";

interface Props {
  value: CurrencyCode;
  onChange: (code: CurrencyCode) => void;
}

export default function CurrencySelector({ value, onChange }: Props) {
  return (
    <div className="flex items-center gap-1.5 bg-white rounded-lg border border-gray-200 p-1">
      {CURRENCY_OPTIONS.map((opt) => (
        <button
          key={opt.code}
          type="button"
          onClick={() => onChange(opt.code)}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
            value === opt.code
              ? "bg-blue-600 text-white"
              : "text-gray-600 hover:bg-gray-100"
          }`}
        >
          {opt.symbol} {opt.code}
        </button>
      ))}
    </div>
  );
}
