"use client";

import { useMemo, useState, useTransition } from "react";
import { BAND_LABEL, type Band, type KeywordRow } from "@/lib/keywords";
import { setAioTracked } from "./actions";

/** AIO引用取得の追加コスト（2026-07-21 実測 $0.0030 - $0.0006）× 週次 */
const AIO_EXTRA_USD_PER_MONTH = (0.003 - 0.0006) * (52 / 12);

// キーワード表（フィルタ＋並び替え。striking distance を強調・§13.3）

const BAND_STYLE: Record<Band, string> = {
  top3: "bg-[var(--ok)]/12 text-[#1a7a2e]",
  top10: "bg-[var(--accent-weak)] text-[var(--accent)]",
  striking: "bg-[var(--warn)]/15 text-[#9a6a00]",
  out: "bg-[var(--panel-2)] text-[var(--faint)]",
};

type SortKey = "impressions" | "clicks" | "position";

/** 上位ドメインとAIO有無（§3.3.5 / §3.3.6）。未計測は「—」で表し 0 と区別する */
function SerpCell({ row }: { row: KeywordRow }) {
  if (!row.serp) {
    return <span className="text-[var(--faint)]" title="SERP未取得">—</span>;
  }
  const { topDomains, ourPosition } = row.serp;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="truncate text-[11px] text-[var(--muted)]" title={topDomains.join(" / ")}>
        {topDomains.map((d) => d.replace(/^www\./, "")).join(" · ") || "—"}
      </span>
      <span className="text-[10px] text-[var(--faint)]">
        自社{" "}
        {ourPosition === null ? (
          <strong className="text-[var(--bad)]">20位圏外</strong>
        ) : (
          <strong className="text-[#1a7a2e]">{ourPosition}位</strong>
        )}
      </span>
    </div>
  );
}

function AioCell({ row }: { row: KeywordRow }) {
  if (!row.serp) return <span className="text-[var(--faint)]">—</span>;
  if (!row.serp.hasAiOverview) {
    return <span className="text-[11px] text-[var(--faint)]">なし</span>;
  }
  const cited = row.serp.aioCitedDomains;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="rounded bg-[var(--warn)]/15 px-1.5 py-0.5 text-[11px] font-medium text-[#9a6a00]">
        あり
      </span>
      {/* ★引用元は aioTracked をONにしたKWでしか取っていない。
          空配列を「引用ゼロ」と読ませないため、未計測は明示する（§3） */}
      {cited.length > 0 ? (
        <span className="text-[10px] text-[var(--faint)]" title={cited.join(" / ")}>
          引用 {cited.length}社
        </span>
      ) : (
        <span className="text-[10px] text-[var(--faint)]">引用元 未計測</span>
      )}
    </div>
  );
}

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

/** AIO引用の取得対象を切り替えるトグル（§3.3.6・コストが伴うため人が押す） */
function AioToggle({
  row,
  onDone,
}: {
  row: KeywordRow;
  onDone: (msg: string, ok: boolean) => void;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await setAioTracked(row.id, !row.aioTracked);
          onDone(res.ok ? res.message : res.error, res.ok);
        })
      }
      title={
        row.aioTracked
          ? "AI Overview の引用ドメインを取得中。クリックで解除"
          : "クリックすると、このKWだけ AI Overview の引用元まで取得します（1件あたり約$0.01/月の追加）"
      }
      className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40 ${
        row.aioTracked
          ? "bg-[var(--accent)] text-white"
          : "border border-[var(--border-strong)] text-[var(--faint)] hover:bg-[var(--panel-2)]"
      }`}
    >
      {pending ? "…" : row.aioTracked ? "取得中" : "オフ"}
    </button>
  );
}

export function KeywordTable({ rows }: { rows: KeywordRow[] }) {
  const [strikingOnly, setStrikingOnly] = useState(false);
  const [aioOnly, setAioOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("impressions");
  const [q, setQ] = useState("");
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const aioCount = rows.filter((r) => r.aioTracked).length;

  const view = useMemo(() => {
    let v = rows;
    if (strikingOnly) v = v.filter((r) => r.band === "striking");
    if (aioOnly) v = v.filter((r) => r.aioTracked);
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
  }, [rows, strikingOnly, aioOnly, sort, q]);

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
        <button
          onClick={() => setAioOnly((v) => !v)}
          className={`rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
            aioOnly
              ? "bg-[var(--accent)] text-white"
              : "border border-[var(--border-strong)] text-[var(--muted)] hover:bg-[var(--panel-2)]"
          }`}
        >
          AIO引用の取得対象のみ（{aioCount}）
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
                <th className="whitespace-nowrap px-3 py-2 font-medium">キーワード</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">現在順位</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">前週差</th>
                <th className="whitespace-nowrap px-3 py-2 text-center font-medium">帯</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">クリック</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">表示</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">CTR</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">検索数</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">難易度</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">担当記事</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">SERP上位（自社順位）</th>
                <th className="whitespace-nowrap px-3 py-2 text-center font-medium">AIO</th>
                <th className="whitespace-nowrap px-3 py-2 text-center font-medium">引用取得</th>
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
                  <td className="max-w-[240px] truncate px-3 py-2.5">{r.keyword}</td>
                  <td className="tnum px-3 py-2.5 text-right font-medium">
                    {r.position !== null ? (
                      r.position.toFixed(1)
                    ) : r.rankState === "never" ? (
                      // ★「圏外」ではない。一度も順位が付いたことがない＝未計測（§3）
                      <span className="text-[11px] text-[var(--faint)]" title="順位データが1件もありません">
                        未計測
                      </span>
                    ) : (
                      <span className="text-[var(--faint)]">圏外</span>
                    )}
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
                  <td className="tnum px-3 py-2.5 text-right text-[var(--muted)]">
                    {r.volume === null ? (
                      <span className="text-[var(--faint)]" title="ラッコ未取得">—</span>
                    ) : (
                      r.volume.toLocaleString("ja-JP")
                    )}
                  </td>
                  <td className="tnum px-3 py-2.5 text-right text-[var(--muted)]">
                    {r.difficulty === null ? (
                      <span className="text-[var(--faint)]">—</span>
                    ) : (
                      r.difficulty
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-[var(--faint)]">
                    {r.assignedArticle ?? "—"}
                  </td>
                  <td className="max-w-[220px] px-3 py-2.5">
                    <SerpCell row={r} />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <AioCell row={r} />
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <AioToggle row={r} onDone={(msg, ok) => setToast({ msg, ok })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {toast && (
        <p
          className={`mt-2 rounded-md px-3 py-2 text-[12px] ${
            toast.ok
              ? "bg-[var(--accent-weak)] text-[var(--accent)]"
              : "bg-[var(--bad)]/10 text-[var(--bad)]"
          }`}
        >
          {toast.msg}
        </p>
      )}
      <p className="mt-2 text-[12px] text-[var(--faint)]">
        {view.length} 件表示。★<span className="text-[#9a6a00]">striking distance（11-20位）</span>
        は「あと少しで1ページ目」＝最も費用対効果の高い改善対象（§13.3）。
      </p>
      <p className="mt-1 text-[12px] text-[var(--faint)]">
        <span className="text-[var(--accent)]">AIO引用</span>：
        全KWで「AI Overview があるか」は取得済み。オンにしたKWだけ
        <strong>誰が引用されているか</strong>まで取得します（§3.3.6）。
        現在 <strong className="tnum">{aioCount}</strong> 件 ＝ 追加コスト 約
        <strong className="tnum">${(aioCount * AIO_EXTRA_USD_PER_MONTH).toFixed(2)}</strong>/月。
      </p>
    </>
  );
}
