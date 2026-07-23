import { getProposedActions, getActionStats } from "@/lib/actions-repo";
import { getInterventions } from "@/lib/interventions";
import { WEEKLY_CAPACITY } from "@/lib/review-queue";
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

  const blocked = proposed.filter((a) => a.blockedBy).length;
  const weak = proposed.filter((a) => !a.blockedBy && a.weakEvidence).length;
  const nav = proposed.filter(
    (a) => !a.blockedBy && a.navigationalShare !== null && a.navigationalShare >= 0.5,
  ).length;

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
        {/* ★処理能力を超える数を同じ重みで並べない。
            上から順に見て力尽きるだけになり、一覧そのものが見られなくなる */}
        {proposed.length > WEEKLY_CAPACITY && (
          <p className="mb-3 rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/[0.08] px-3 py-2 text-[12px] leading-relaxed text-[#9a6a00]">
            承認待ち <strong>{proposed.length}件</strong>に対し、実際に回せるのは
            <strong>週{WEEKLY_CAPACITY}本</strong>（実績）。
            <strong>取り逃している表示回数の多い順</strong>に並べ、
            {blocked > 0 && <>判定待ちと重なる{blocked}件、</>}
            {nav > 0 && <>指名検索が主で直しても効かない{nav}件、</>}
            根拠の弱い{weak}件は後ろへ回しています。
            <br />
            ★上位{WEEKLY_CAPACITY}件だけ見れば足ります。残りは14日で自動的に期限切れになります
            （放置しても溜まり続けません）。
          </p>
        )}
        {proposed.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--panel)] p-8 text-center text-[13px] text-[var(--faint)]">
            承認待ちの提案はありません。右上「立案を実行」で、記事の実測（CTR異常・striking
            distance・弱いピラー）から改善案を起票します。
          </div>
        ) : (
          <div className="grid gap-3">
            {proposed.slice(0, WEEKLY_CAPACITY).map((a) => (
              <ActionCard key={a.id} action={a} />
            ))}
            {proposed.length > WEEKLY_CAPACITY && (
              <details className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
                <summary className="cursor-pointer text-[13px] font-medium">
                  残り {proposed.length - WEEKLY_CAPACITY}件を見る
                  <span className="ml-2 text-[11px] font-normal text-[var(--faint)]">
                    （優先度が低い順。判定待ちと重なるもの・根拠が弱いものを含む）
                  </span>
                </summary>
                <div className="mt-3 grid gap-3">
                  {proposed.slice(WEEKLY_CAPACITY).map((a) => (
                    <ActionCard key={a.id} action={a} />
                  ))}
                </div>
              </details>
            )}
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
