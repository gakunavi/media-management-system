import { getProposedActions, getActionStats } from "@/lib/actions-repo";
import { getInterventions } from "@/lib/interventions";
import { ActionCard, RunOperatorButton } from "./action-card";
import { runOperator } from "./actions";
import { ManualRecord } from "./manual-record";
import { InterventionTable } from "./intervention-table";

// 施策・PDCA（設計書 §4.1 段5「次の一手」・§5.2 立案・§5.3 判定）
export const dynamic = "force-dynamic";

const jaDate = (d: Date | null) =>
  d ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";


export default async function ExperimentsPage() {
  const [proposed, stats, interventions] = await Promise.all([
    getProposedActions(),
    getActionStats(),
    getInterventions(),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">施策・PDCA</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            立案（§5.2）→ 承認 → 実行 → 対照群補正つき自動判定（§5.3）
          </p>
        </div>
        <RunOperatorButton onRun={runOperator} />
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <Stat label="承認待ち" value={stats.proposed} accent />
        <Stat label="実行中（判定待ち）" value={stats.approved} />
        <Stat label="却下" value={stats.rejected} />
        <Stat label="完了" value={stats.done} />
      </div>

      {/* ★立案していない施策も同じ判定経路に乗せる（入口が無いと記録が止まる） */}
      <ManualRecord />

      {/* 段5「次の一手」 */}
      <section className="mb-6">
        <h2 className="mb-3 flex items-center gap-2 text-[15px] font-semibold">
          <span className="inline-flex h-5 items-center rounded-md bg-[var(--ink)] px-1.5 text-[11px] font-semibold text-white">
            段5
          </span>
          次の一手（承認待ち {proposed.length}件）
        </h2>
        {proposed.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--panel)] p-8 text-center text-[13px] text-[var(--faint)]">
            承認待ちの提案はありません。右上「立案を実行」で、記事の実測（CTR異常・striking
            distance・弱いピラー）から改善案を起票します。
          </div>
        ) : (
          <div className="grid gap-3">
            {proposed.map((a) => (
              <ActionCard key={a.id} action={a} />
            ))}
          </div>
        )}
      </section>

      <InterventionTable rows={interventions} />
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
      <div className="text-[12px] text-[var(--muted)]">{label}</div>
      <div className={`tnum mt-1 text-2xl font-bold leading-none ${accent ? "text-[var(--accent)]" : ""}`}>
        {value}
      </div>
    </div>
  );
}
