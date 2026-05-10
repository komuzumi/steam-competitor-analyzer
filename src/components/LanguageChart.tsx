"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { LanguageStat } from "@/types";

const COLORS = [
  "#60a5fa",
  "#2563eb",
  "#f97316",
  "#facc15",
  "#475569",
  "#94a3b8",
  "#dc2626",
  "#0f766e",
  "#10b981",
  "#f59e0b",
  "#7c3aed",
  "#ec4899",
  "#64748b",
];

function compactNumber(value: number): string {
  return value.toLocaleString("ja-JP");
}

function percent(value: number, total: number): string {
  if (total <= 0) return "0.0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

interface Props {
  stats: LanguageStat[];
}

export default function LanguageChart({ stats }: Props) {
  const [mode, setMode] = useState<"pie" | "bar">("pie");
  const total = useMemo(() => stats.reduce((sum, stat) => sum + stat.count, 0), [stats]);

  const pieData = useMemo(() => {
    const top = stats.slice(0, 12);
    const rest = stats.slice(12);
    const restCount = rest.reduce((sum, stat) => sum + stat.count, 0);
    const data = top.map((stat) => ({
      name: stat.displayName ?? stat.language,
      value: stat.count,
      positive: stat.positive,
      negative: stat.negative,
    }));

    if (restCount > 0) {
      data.push({
        name: "Other",
        value: restCount,
        positive: rest.reduce((sum, stat) => sum + stat.positive, 0),
        negative: rest.reduce((sum, stat) => sum + stat.negative, 0),
      });
    }

    return data;
  }, [stats]);

  const barData = useMemo(
    () =>
      stats.slice(0, 20).map((stat) => ({
        name: stat.displayName ?? stat.language,
        count: stat.count,
        positive: stat.positive,
        negative: stat.negative,
        share: percent(stat.count, total),
      })),
    [stats, total],
  );

  if (stats.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 className="font-semibold text-gray-800">言語別レビュー分布</h4>
          <p className="text-xs text-gray-500">総レビューに対する言語別割合</p>
        </div>
        <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1">
          <button
            type="button"
            onClick={() => setMode("pie")}
            className={`px-3 py-1 text-xs font-medium rounded-md ${
              mode === "pie" ? "bg-white text-blue-700 shadow-sm" : "text-gray-600"
            }`}
          >
            円
          </button>
          <button
            type="button"
            onClick={() => setMode("bar")}
            className={`px-3 py-1 text-xs font-medium rounded-md ${
              mode === "bar" ? "bg-white text-blue-700 shadow-sm" : "text-gray-600"
            }`}
          >
            横棒
          </button>
        </div>
      </div>

      <div className="h-80 min-w-0 rounded-lg border border-gray-100 bg-white">
        <ResponsiveContainer width="100%" height="100%" minWidth={300} minHeight={300}>
          {mode === "pie" ? (
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={110}
                label={({ value }) => percent(Number(value), total)}
                labelLine={false}
              >
                {pieData.map((entry, index) => (
                  <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value, _name, item) => {
                  const numericValue = Number(value ?? 0);
                  const payload = item.payload as { name?: string } | undefined;
                  return [
                    `${compactNumber(numericValue)}件 (${percent(numericValue, total)})`,
                    payload?.name ?? "",
                  ];
                }}
              />
              <Legend layout="vertical" align="right" verticalAlign="middle" />
            </PieChart>
          ) : (
            <BarChart data={barData} layout="vertical" margin={{ top: 16, right: 24, bottom: 16, left: 80 }}>
              <XAxis type="number" tickFormatter={compactNumber} />
              <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 12 }} />
              <Tooltip
                formatter={(value) => `${compactNumber(Number(value ?? 0))}件`}
                labelFormatter={(label) => `${label}`}
              />
              <Bar dataKey="count" name="レビュー数" radius={[0, 6, 6, 0]} fill="#2563eb" />
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
