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
    <div className="bg-white rounded-xl shadow-md p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-gray-800">Markdownレポート</h3>
        <button
          onClick={handleCopy}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            copied
              ? "bg-green-100 text-green-700"
              : "bg-blue-600 text-white hover:bg-blue-700"
          }`}
        >
          {copied ? "コピーしました!" : "Markdownをコピー"}
        </button>
      </div>
      <pre className="bg-gray-50 rounded-lg p-4 text-xs text-gray-700 overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
        {markdown}
      </pre>
    </div>
  );
}
