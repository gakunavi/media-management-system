"use client";

import { useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";

// 記事の指標推移グラフ（設計書 §3.2.3「記事別の日次推移」）
// ★順位は「小さいほど良い」ので Y軸を反転する。

type Point = {
  date: string;
  clicks: number | null;
  impressions: number | null;
  position: number | null;
  pv: number | null;
};

const METRICS = [
  { key: "clicks", label: "クリック", color: "#0b7285", reversed: false },
  { key: "impressions", label: "表示", color: "#748ffc", reversed: false },
  { key: "position", label: "掲載順位", color: "#e8590c", reversed: true },
  { key: "pv", label: "PV", color: "#2f9e44", reversed: false },
] as const;

export function MetricChart({ series }: { series: Point[] }) {
  const [active, setActive] = useState<(typeof METRICS)[number]["key"]>("clicks");
  const meta = METRICS.find((m) => m.key === active)!;

  const data = series.filter((p) => p[active] !== null);

  return (
    <div>
      <div className="mb-3 flex gap-1.5">
        {METRICS.map((m) => {
          const has = series.some((p) => p[m.key] !== null);
          return (
            <button
              key={m.key}
              disabled={!has}
              onClick={() => setActive(m.key)}
              className={`rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors ${
                active === m.key
                  ? "bg-[var(--ink)] text-white"
                  : has
                    ? "bg-[var(--panel-2)] text-[var(--muted)] hover:bg-[var(--border)]"
                    : "cursor-not-allowed bg-[var(--panel-2)] text-[var(--faint)] opacity-50"
              }`}
            >
              {m.label}
            </button>
          );
        })}
      </div>

      {data.length === 0 ? (
        <div className="flex h-64 items-center justify-center text-[13px] text-[var(--faint)]">
          この指標のデータがありません
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -8 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "var(--faint)" }}
              tickFormatter={(d: string) => d.slice(5)}
              minTickGap={28}
              stroke="var(--border)"
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--faint)" }}
              reversed={meta.reversed}
              width={44}
              stroke="var(--border)"
              domain={meta.reversed ? [1, "dataMax"] : [0, "dataMax"]}
            />
            <Tooltip
              contentStyle={{
                background: "var(--panel)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelStyle={{ color: "var(--muted)" }}
              formatter={(v: number) => [v, meta.label]}
            />
            <Line
              type="monotone"
              dataKey={active}
              stroke={meta.color}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      )}
      {meta.reversed && (
        <p className="mt-1 text-[11px] text-[var(--faint)]">
          ※ 掲載順位は小さいほど上位。グラフは上が良い向きに反転しています。
        </p>
      )}
    </div>
  );
}
