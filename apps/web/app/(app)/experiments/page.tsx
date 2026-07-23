import {
  getProposedActions,
  getActionStats,
  splitByQuota,
  MONTHLY_QUOTA,
} from "@/lib/actions-repo";
import { getInterventions } from "@/lib/interventions";
import { WEEKLY_CAPACITY } from "@/lib/review-queue";
import type { ProposedAction } from "@/lib/actions-repo";
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

  const q = splitByQuota(proposed);
  const rest = q.restRewrite.length + q.restNew.length;

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
        {/* ★重み係数ではなく枠で分ける（cowork 2026-07-24）。
            表示回数の単一ソートは新規記事を構造的に最下位へ沈める
            （SERPに不在＝表示0なので、取り逃し表示では価値を測れない）。 */}
        <p className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[12px] leading-relaxed text-[var(--muted)]">
          月{MONTHLY_QUOTA.rewrite + MONTHLY_QUOTA.newArticle}枠を
          <strong>リライト{MONTHLY_QUOTA.rewrite}・新規{MONTHLY_QUOTA.newArticle}</strong>
          に分けています。★<strong>表示回数だけで並べると新規記事が永久に着手されません</strong>
          （SERPに居ない＝表示0なので、取り逃している表示では価値を測れない）。
          内部リンクと Threads は<strong>枠外</strong>（1件15〜30分の軽作業なので、
          記事の枠を消費させない）。
        </p>

        {proposed.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--panel)] p-8 text-center text-[13px] text-[var(--faint)]">
            承認待ちの提案はありません。右上「立案を実行」で、記事の実測（CTR異常・striking
            distance・弱いピラー）から改善案を起票します。
          </div>
        ) : (
          <div className="grid gap-5">
            <QuotaGroup
              title={`リライト（${q.rewrite.length} / ${MONTHLY_QUOTA.rewrite}枠）`}
              note="既存の資産を伸ばす。効果は1〜3ヶ月で出る。取り逃している表示の多い順。"
              rows={q.rewrite}
            />
            <QuotaGroup
              title={`新規記事（${q.newArticle.length} / ${MONTHLY_QUOTA.newArticle}枠）`}
              note="SERPに自社が居ないKW。ここでしか取れないが、効果は6〜12ヶ月かかる。"
              rows={q.newArticle}
            />
            {q.light.length > 0 && (
              <QuotaGroup
                title={`枠外の軽作業（${q.light.length}件）`}
                note="内部リンク・Threads。記事1本ぶんの工数がかからないので随時。"
                rows={q.light}
              />
            )}
            {rest > 0 && (
              <details className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3">
                <summary className="cursor-pointer text-[13px] font-medium">
                  枠に入らなかった {rest}件を見る
                  <span className="ml-2 text-[11px] font-normal text-[var(--faint)]">
                    （判定待ちと重なる・指名検索が主・検索語が取れていない・母数が小さい）
                  </span>
                </summary>
                <div className="mt-3 grid gap-3">
                  {[...q.restRewrite, ...q.restNew].map((a) => (
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

/** 枠ごとのグループ。★枠が埋まっていないこと自体が情報（0件なら候補が無い） */
function QuotaGroup({
  title,
  note,
  rows,
}: {
  title: string;
  note: string;
  rows: ProposedAction[];
}) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <p className="mb-2 mt-0.5 text-[11px] text-[var(--faint)]">{note}</p>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-[var(--border-strong)] p-4 text-center text-[12px] text-[var(--faint)]">
          候補がありません。
        </p>
      ) : (
        <div className="grid gap-3">
          {rows.map((a) => (
            <ActionCard key={a.id} action={a} />
          ))}
        </div>
      )}
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
