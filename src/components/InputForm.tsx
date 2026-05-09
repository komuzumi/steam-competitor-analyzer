"use client";

import { useState } from "react";
import { extractAppId } from "@/lib/steam";

const REVIEW_LIMIT_OPTIONS = [
  { value: 100, label: "100件" },
  { value: 500, label: "500件" },
  { value: 1000, label: "1,000件" },
  { value: 5000, label: "5,000件" },
  { value: 0, label: "全件" },
];

interface Props {
  onSubmit: (appIds: string[], reviewLimit: number) => void;
  isLoading: boolean;
}

export default function InputForm({ onSubmit, isLoading }: Props) {
  const [inputs, setInputs] = useState<string[]>([""]);
  const [reviewLimit, setReviewLimit] = useState<number>(500);
  const [error, setError] = useState<string>("");

  const addInput = () => {
    if (inputs.length < 5) {
      setInputs([...inputs, ""]);
    }
  };

  const removeInput = (index: number) => {
    if (inputs.length > 1) {
      setInputs(inputs.filter((_, i) => i !== index));
    }
  };

  const updateInput = (index: number, value: string) => {
    const newInputs = [...inputs];
    newInputs[index] = value;
    setInputs(newInputs);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    const filledInputs = inputs.filter((input) => input.trim() !== "");
    if (filledInputs.length === 0) {
      setError("少なくとも1つのSteam URLまたはAppIDを入力してください");
      return;
    }

    const appIds: string[] = [];
    for (const input of filledInputs) {
      const appId = extractAppId(input);
      if (!appId) {
        setError(`「${input}」からAppIDを抽出できません。Steam URLまたは数字のAppIDを入力してください。`);
        return;
      }
      appIds.push(appId);
    }

    onSubmit(appIds, reviewLimit);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl mx-auto">
      <div className="space-y-3">
        {inputs.map((input, index) => (
          <div key={index} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => updateInput(index, e.target.value)}
              placeholder="Steam URLまたはAppID（例: 1245620 or https://store.steampowered.com/app/1245620/）"
              className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm text-gray-900 bg-white"
              disabled={isLoading}
            />
            {inputs.length > 1 && (
              <button
                type="button"
                onClick={() => removeInput(index)}
                className="px-3 py-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                disabled={isLoading}
              >
                x
              </button>
            )}
          </div>
        ))}
      </div>

      {/* レビュー取得件数 */}
      <div className="mt-4 flex items-center justify-center gap-2">
        <label className="text-sm text-gray-600">レビュー取得数:</label>
        <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-1">
          {REVIEW_LIMIT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setReviewLimit(opt.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                reviewLimit === opt.value
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
              disabled={isLoading}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="mt-2 text-red-600 text-sm">{error}</p>
      )}

      <div className="mt-4 flex gap-3 justify-center">
        {inputs.length < 5 && (
          <button
            type="button"
            onClick={addInput}
            className="px-4 py-2 text-blue-600 border border-blue-300 rounded-lg hover:bg-blue-50 transition-colors text-sm"
            disabled={isLoading}
          >
            + タイトル追加
          </button>
        )}
        <button
          type="submit"
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
          disabled={isLoading}
        >
          {isLoading ? "分析中..." : "分析開始"}
        </button>
      </div>
    </form>
  );
}
