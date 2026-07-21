import { getKeywordList, computeStats } from "@/lib/keywords";
import { getKeywordCandidates } from "@/lib/keyword-candidates";
import { KeywordTable } from "./keyword-table";
import { Candidates } from "./candidates";

// キーワード（設計書 §4.2 /keywords・§13.3 striking distance・§3.3.3 順位分布）
export const dynamic = "force-dynamic";

const jaDate = (d: Date | null) =>
  d ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";

export default async function KeywordsPage() {
  const [{ rows, latestDate, droppedOut }, candidates] = await Promise.all([
    getKeywordList(),
    getKeywordCandidates(),
  ]);
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

      <Candidates candidates={candidates} />

      <KeywordTable rows={rows} />

      <p className="mt-3 text-[12px] text-[var(--faint)]">
        検索数・難易度・担当記事はラッコの調査済みKWのみ（§3-8）。「—」は未取得であって0ではない。
        順位の「未計測」は一度も順位が付いたことがないKW（追加直後）で、「圏外」とは別。
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
