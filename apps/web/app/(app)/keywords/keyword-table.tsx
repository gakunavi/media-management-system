"use client";

import { useMemo, useState } from "react";
import { BAND_LABEL, type Band, type KeywordRow } from "@/lib/keywords";

// キーワード表（フィルタ＋並び替え。striking distance を強調・§13.3）

const BAND_STYLE: Record<Band, string> = {
  top3: "bg-[var(--ok)]/12 text-[#1a7a2e]",
  top10: "bg-[var(--accent-weak)] text-[var(--accent)]",
  striking: "bg-[var(--warn)]/15 text-[#9a6a00]",
  out: "bg-[var(--panel-2)] text-[var(--faint)]",
};

type SortKey = "impressions" | "clicks" | "position";

function PositionDelta({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0) return <span className="text-[var(--faint)]">±0</span>;
  const improved = delta > 0;
  return (
    <span className={improved ? "text-[#1a7a2e]" : "text-[var(--bad)]"}>
      {improved ? "▲" : "▼"}
      {Math.abs(delta).toFixed(1)}
    </span>
  );
}

export function KeywordTable({ rows }: { rows: KeywordRow[] }) {
  const [strikingOnly, setStrikingOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("impressions");
  const [q, setQ] = useState("");

  const view = useMemo(() => {
    let v = rows;
    if (strikingOnly) v = v.filter((r) => r.band === "striking");
    if (q.trim()) v = v.filter((r) => r.keyword.includes(q.trim()));
    const sorted = [...v].sort((a, b) => {
      if (sort === "position") {
        // 圏外(null)は末尾。小さいほど上位
        if (a.position === null) return 1;
        if (b.position === null) return -1;
        return a.position - b.position;
      }
      return (b[sort] as number) - (a[sort] as number);
    });
    return sorted;
  }, [rows, strikingOnly, sort, q]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="キーワード検索"
          className="rounded-md border border-[var(--border-strong)] bg-[var(--panel)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]"
        />
        <button
          onClick={() => setStrikingOnly((v) => !v)}
          className={`rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
            strikingOnly
              ? "bg-[var(--warn)] text-white"
              : "border border-[var(--border-strong)] text-[var(--muted)] hover:bg-[var(--panel-2)]"
          }`}
        >
          striking distance のみ（11-20位）
        </button>
        <div className="ml-auto flex items-center gap-1 text-[12px] text-[var(--muted)]">
          <span>並び:</span>
          {(
            [
              ["impressions", "表示"],
              ["clicks", "クリック"],
              ["position", "順位"],
            ] as [SortKey, string][]
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`rounded px-2 py-1 ${
                sort === k ? "bg-[var(--ink)] text-white" : "hover:bg-[var(--panel-2)]"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                <th className="px-3 py-2 font-medium">キーワード</th>
                <th className="px-3 py-2 text-right font-medium">現在順位</th>
                <th className="px-3 py-2 text-right font-medium">前週差</th>
                <th className="px-3 py-2 text-center font-medium">帯</th>
                <th className="px-3 py-2 text-right font-medium">クリック</th>
                <th className="px-3 py-2 text-right font-medium">表示</th>
                <th className="px-3 py-2 text-right font-medium">CTR</th>
              </tr>
            </thead>
            <tbody>
              {view.map((r) => (
                <tr
                  key={r.id}
                  className={`border-b border-[var(--border)] last:border-0 hover:bg-[var(--panel-2)] ${
                    r.band === "striking" ? "bg-[var(--warn)]/[0.04]" : ""
                  }`}
                >
                  <td className="max-w-[360px] truncate px-3 py-2.5">{r.keyword}</td>
                  <td className="tnum px-3 py-2.5 text-right font-medium">
                    {r.position === null ? "圏外" : r.position.toFixed(1)}
                  </td>
                  <td className="tnum px-3 py-2.5 text-right">
                    <PositionDelta delta={r.positionDelta} />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {r.band && (
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${BAND_STYLE[r.band]}`}
                      >
                        {BAND_LABEL[r.band]}
                      </span>
                    )}
                  </td>
                  <td className="tnum px-3 py-2.5 text-right">{r.clicks.toLocaleString("ja-JP")}</td>
                  <td className="tnum px-3 py-2.5 text-right text-[var(--muted)]">
                    {r.impressions.toLocaleString("ja-JP")}
                  </td>
                  <td className="tnum px-3 py-2.5 text-right text-[var(--muted)]">
                    {r.ctr === null ? "—" : `${(r.ctr * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-2 text-[12px] text-[var(--faint)]">
        {view.length} 件表示。★<span className="text-[#9a6a00]">striking distance（11-20位）</span>
        は「あと少しで1ページ目」＝最も費用対効果の高い改善対象（§13.3）。
      </p>
    </>
  );
}
