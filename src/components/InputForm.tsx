"use client";

import { useState } from "react";
import { extractAppId } from "@/lib/steam";

interface Props {
  onSubmit: (appIds: string[]) => void;
  isLoading: boolean;
}

export default function InputForm({ onSubmit, isLoading }: Props) {
  const [inputs, setInputs] = useState<string[]>([""]);
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
    const nextInputs = [...inputs];
    nextInputs[index] = value;
    setInputs(nextInputs);
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

    onSubmit(appIds);
  };

  return (
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-2xl">
      <div className="space-y-3">
        {inputs.map((input, index) => (
          <div key={index} className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => updateInput(index, e.target.value)}
              placeholder="Steam URLまたはAppID（例: 1245620 or https://store.steampowered.com/app/1245620/）"
              className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isLoading}
            />
            {inputs.length > 1 && (
              <button
                type="button"
                onClick={() => removeInput(index)}
                className="rounded-lg px-3 py-2 text-red-500 transition-colors hover:bg-red-50"
                disabled={isLoading}
              >
                x
              </button>
            )}
          </div>
        ))}
      </div>

      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex justify-center gap-3">
        {inputs.length < 5 && (
          <button
            type="button"
            onClick={addInput}
            className="rounded-lg border border-blue-300 px-4 py-2 text-sm text-blue-600 transition-colors hover:bg-blue-50"
            disabled={isLoading}
          >
            + タイトル追加
          </button>
        )}
        <button
          type="submit"
          className="rounded-lg bg-blue-600 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isLoading}
        >
          {isLoading ? "分析中..." : "分析開始"}
        </button>
      </div>
    </form>
  );
}
