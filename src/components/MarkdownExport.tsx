"use client";

import { useState } from "react";
import { GameAnalysis } from "@/types";
import { CurrencyCode } from "@/lib/currency";
import { generateMarkdownReport } from "@/lib/markdown";

interface Props {
  results: GameAnalysis[];
  currency: CurrencyCode;
}

export default function MarkdownExport({ results, currency }: Props) {
  const [copied, setCopied] = useState(false);
  const markdown = generateMarkdownReport(results, currency);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-lg font-bold text-slate-900">Markdownレポート</h3>
        <button
          type="button"
          onClick={handleCopy}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
            copied ? "bg-green-100 text-green-700" : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          {copied ? "コピーしました" : "Markdownをコピー"}
        </button>
      </div>
      <pre className="max-h-96 overflow-y-auto overflow-x-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-xs text-slate-700">
        {markdown}
      </pre>
    </div>
  );
}
