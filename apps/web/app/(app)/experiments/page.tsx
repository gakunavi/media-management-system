import { getProposedActions, getActionStats } from "@/lib/actions-repo";
import { getInterventions } from "@/lib/interventions";
import { ActionCard, RunOperatorButton } from "./action-card";
import { runOperator } from "./actions";
import { ManualRecord } from "./manual-record";

// 施策・PDCA（設計書 §4.1 段5「次の一手」・§5.2 立案・§5.3 判定）
export const dynamic = "force-dynamic";

const jaDate = (d: Date | null) =>
  d ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";

const VERDICT_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: "判定待ち", cls: "bg-[var(--panel-2)] text-[var(--muted)]" },
  positive: { label: "効果あり", cls: "bg-[var(--ok)]/12 text-[#1a7a2e]" },
  neutral: { label: "有意差なし", cls: "bg-[var(--panel-2)] text-[var(--muted)]" },
  negative: { label: "悪化", cls: "bg-[var(--bad)]/12 text-[var(--bad)]" },
  inconclusive: { label: "判定不能", cls: "bg-[var(--warn)]/15 text-[#9a6a00]" },
};

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

      {/* 実行済み（Intervention）と判定 */}
      <section>
        <h2 className="mb-3 text-[15px] font-semibold">
          実行済みの打ち手と効果判定（{interventions.length}件）
        </h2>
        {interventions.length === 0 ? (
          <p className="text-[13px] text-[var(--faint)]">まだありません。</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                    <th className="px-3 py-2 font-medium">適用日</th>
                    <th className="px-3 py-2 font-medium">打ち手</th>
                    <th className="px-3 py-2 font-medium">対象</th>
                    <th className="px-3 py-2 font-medium">判定日</th>
                    <th className="px-3 py-2 font-medium">判定</th>
                  </tr>
                </thead>
                <tbody>
                  {interventions.map((iv) => {
                    const v = VERDICT_LABEL[iv.verdict] ?? VERDICT_LABEL.pending;
                    return (
                      <tr key={iv.id} className="border-b border-[var(--border)] last:border-0">
                        <td className="whitespace-nowrap px-3 py-2.5">{jaDate(iv.appliedAt)}</td>
                        <td className="px-3 py-2.5">{iv.type}</td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12px]">
                          {iv.contentExternalId ?? "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-[var(--muted)]">
                          {jaDate(iv.evaluateAt)}
                          {iv.due && iv.verdict === "pending" && (
                            <span className="ml-1 text-[var(--warn)]">●判定期日</span>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${v.cls}`}>
                            {v.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <p className="mt-3 text-[12px] text-[var(--faint)]">
          判定は適用後28日の実測 −
          適用前28日 − 対照群トレンドで自動算出（§5.3）。自動判定ジョブは P8 で worker に登録。
        </p>
      </section>
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
