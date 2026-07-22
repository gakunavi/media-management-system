// 表示期間の切り替え（全画面共通）
//
// ★JS を持たせない。プリセットはただのリンク、任意区間は素の GET フォーム。
//   期間切り替えのためだけにクライアント JS を積む理由がない。
//
// ★いま何日間を見ているのかを必ず文字で出す。「直近30日」と書いていないと、
//   画面の数字がいつのものか分からないまま判断することになる。
import Link from "next/link";
import { RANGE_PRESETS, type Range, jstDayKey } from "@/lib/period";

export function RangePicker({
  range,
  basePath,
  /** 期間以外に保持したいクエリ（タブなど） */
  keep = {},
}: {
  range: Range;
  basePath: string;
  keep?: Record<string, string | undefined>;
}) {
  const qs = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) p.set(k, v);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `${basePath}?${p.toString()}`;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-md border border-[var(--border-strong)]">
        {RANGE_PRESETS.map((p) => (
          <Link
            key={p.key}
            href={qs({ range: p.key })}
            className={`px-2.5 py-1 text-[12px] transition-colors ${
              range.key === p.key
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--panel)] text-[var(--muted)] hover:bg-[var(--panel-2)]"
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      <form method="get" action={basePath} className="flex items-center gap-1">
        {Object.entries(keep).map(([k, v]) =>
          v ? <input key={k} type="hidden" name={k} value={v} /> : null,
        )}
        <input
          type="date"
          name="from"
          defaultValue={jstDayKey(range.since)}
          className="rounded-md border border-[var(--border-strong)] bg-[var(--panel)] px-1.5 py-1 text-[12px]"
        />
        <span className="text-[12px] text-[var(--faint)]">〜</span>
        <input
          type="date"
          name="to"
          defaultValue={jstDayKey(new Date(range.until.getTime() - 1))}
          className="rounded-md border border-[var(--border-strong)] bg-[var(--panel)] px-1.5 py-1 text-[12px]"
        />
        <button
          type="submit"
          className="rounded-md border border-[var(--border-strong)] px-2 py-1 text-[12px] text-[var(--muted)] transition-colors hover:bg-[var(--panel-2)]"
        >
          適用
        </button>
      </form>
    </div>
  );
}

/** 画面上部に出す「いまどの期間を見ているか」の一行 */
export function RangeCaption({ range, note }: { range: Range; note?: string }) {
  return (
    <p className="mt-0.5 text-[13px] text-[var(--muted)]">
      {range.label}
      {range.period ? "・月次目標と比較できる期間" : "・暦月と一致しないため月次目標とは比較しない"}
      {note ? `・${note}` : ""}
    </p>
  );
}
