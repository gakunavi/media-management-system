import { getKeywordList, computeStats } from "@/lib/keywords";
import { KeywordTable } from "./keyword-table";

// キーワード（設計書 §4.2 /keywords・§13.3 striking distance・§3.3.3 順位分布）
export const dynamic = "force-dynamic";

const jaDate = (d: Date | null) =>
  d ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";

export default async function KeywordsPage() {
  const { rows, latestDate, droppedOut } = await getKeywordList();
  const s = computeStats(rows);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">キーワード</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            最新スナップショット {jaDate(latestDate)}・追跡 {s.total}件
            {droppedOut > 0 && (
              <span className="text-[var(--faint)]">
                （前回まで追跡・今回圏外 {droppedOut}件）
              </span>
            )}
          </p>
        </div>
      </div>

      {/* 順位分布（§3.3.3 トップページ食い込み率） */}
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <BandStat label="1-3位" value={s.top3} tone="ok" hint="CTRが跳ねる最上位" />
        <BandStat label="4-10位" value={s.top10} tone="accent" hint="1ページ目" />
        <BandStat
          label="11-20位"
          value={s.striking}
          tone="warn"
          hint="★striking distance"
        />
        <BandStat label="21位〜" value={s.out} tone="faint" hint="圏外に近い" />
      </div>

      <KeywordTable rows={rows} />

      <p className="mt-3 text-[12px] text-[var(--faint)]">
        volume・難易度・割当記事・鮮度は未取得（ラッコ連携＝P4.5/P4.10、記事割当＝P4.5）。
        striking distance の自動起票（段5）は P4.7。
      </p>
    </div>
  );
}

function BandStat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: "ok" | "accent" | "warn" | "faint";
  hint: string;
}) {
  const color =
    tone === "ok"
      ? "text-[#1a7a2e]"
      : tone === "accent"
        ? "text-[var(--accent)]"
        : tone === "warn"
          ? "text-[#9a6a00]"
          : "text-[var(--faint)]";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
      <div className="text-[12px] text-[var(--muted)]">{label}</div>
      <div className={`tnum mt-1 text-2xl font-bold leading-none ${color}`}>{value}</div>
      <div className="mt-1 text-[10px] text-[var(--faint)]">{hint}</div>
    </div>
  );
}
