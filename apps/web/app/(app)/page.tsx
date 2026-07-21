import Link from "next/link";
import { NOT_MEASURED } from "@mms/shared";
import {
  currentPeriod,
  getGoals,
  getFunnel,
  getBuyerQuality,
  getJobHealth,
  type GoalRow,
} from "@/lib/dashboard";
import { getActionStats, type ActionStats } from "@/lib/actions-repo";

// ★石井さんが毎日見る画面（設計書 §4.1 段1〜段3・段7）。
//   段4/段5/段6 は operator（P4）で追加する。
export const dynamic = "force-dynamic";

const jaDate = (d: Date | null) =>
  d
    ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" })
    : "—";
const jaDateTime = (d: Date | null) =>
  d
    ? d.toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "未実行";

export default async function Dashboard() {
  const period = currentPeriod();
  const [goals, funnel, buyer, health, actionStats] = await Promise.all([
    getGoals(period),
    getFunnel(),
    getBuyerQuality(),
    getJobHealth(),
    getActionStats(),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">ダッシュボード</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            獲得3ゴールの結果と、そこに至るファネルを1画面で
          </p>
        </div>
        {health.threads.alert === "red" && (
          <span className="rounded-md bg-[var(--bad)]/10 px-2 py-1 text-[12px] font-medium text-[var(--bad)]">
            ● Threads 投稿が {health.threads.gapDays}日 停止（段7）
          </span>
        )}
        {health.gsc.alert === "red" && (
          <span className="rounded-full bg-[var(--bad)]/10 px-3 py-1 text-[12px] font-medium text-[var(--bad)]">
            ● 計測に問題あり（段7）
          </span>
        )}
      </div>

      <div className="grid gap-4">
        <GoalsPanel goals={goals} />
        <FunnelPanel funnel={funnel} />
        <NextActionsPanel stats={actionStats} />
        <div className="grid gap-4 lg:grid-cols-2">
          <BuyerPanel buyer={buyer} />
          <HealthPanel health={health} />
        </div>
      </div>

      <p className="mt-6 text-center text-[12px] text-[var(--faint)]">
        段4「今週の変化」・段6「施策の生死」は P4/P8 で追加。
        すべての値は <Unmeasured small /> と実測ゼロを区別しています（§3 規約）。
      </p>
    </div>
  );
}

/* ─────────────────────────── 共通 ─────────────────────────── */

function Panel({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="mb-4 flex items-baseline gap-2.5">
        <span className="inline-flex h-5 items-center rounded-md bg-[var(--ink)] px-1.5 text-[11px] font-semibold text-white">
          段{n}
        </span>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {hint && <span className="ml-auto text-[11px] text-[var(--faint)]">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Unmeasured({ small }: { small?: boolean }) {
  return (
    <span className={`font-medium text-[var(--warn)] ${small ? "text-xs" : ""}`}>
      {NOT_MEASURED}
    </span>
  );
}

/* ─────────────────────────── 段1 ─────────────────────────── */

function GoalsPanel({ goals }: { goals: GoalRow[] }) {
  return (
    <Panel n={1} title="結果（獲得3ゴール）" hint="最優先＝直客">
      <div className="grid gap-3 sm:grid-cols-3">
        {goals.map((g) => {
          const pct =
            g.actual !== null && g.target
              ? Math.min(100, Math.round((g.actual / g.target) * 100))
              : null;
          const dot =
            g.actual === null
              ? "bg-[var(--warn)]"
              : pct !== null && pct >= 100
                ? "bg-[var(--ok)]"
                : pct !== null && pct >= 50
                  ? "bg-[var(--warn)]"
                  : "bg-[var(--bad)]";
          return (
            <div
              key={g.key}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4"
            >
              <div className="flex items-center gap-2 text-[13px] text-[var(--muted)]">
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                {g.label}
              </div>
              <div className="mt-2 flex items-baseline gap-1.5">
                {g.actual === null ? (
                  <Unmeasured />
                ) : (
                  <span className="tnum text-3xl font-bold leading-none">{g.actual}</span>
                )}
                <span className="tnum text-[13px] text-[var(--faint)]">
                  {g.target !== null ? `/ ${g.target}件` : ""}
                </span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
                {pct !== null && (
                  <div
                    className="h-full rounded-full bg-[var(--accent)]"
                    style={{ width: `${pct}%` }}
                  />
                )}
              </div>
              <div className="mt-1.5 text-right text-[11px] text-[var(--faint)]">
                {g.target === null ? "目標未設定" : pct !== null ? `${pct}%` : ""}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[12px] text-[var(--faint)]">
        計測開始前は 0 ではなく <Unmeasured small /> と表示（§3 規約）。WPフォーム接続で計測が始まる。
      </p>
    </Panel>
  );
}

/* ─────────────────────────── 段2 ─────────────────────────── */

function FunnelPanel({ funnel }: { funnel: Awaited<ReturnType<typeof getFunnel>> }) {
  const measured = funnel.rows.map((r) => r.value).filter((v): v is number => v !== null);
  const max = measured.length ? Math.max(...measured) : 0;

  return (
    <Panel
      n={2}
      title="ファネル（どこで落ちているか）"
      hint={funnel.asOf ? `表示・クリックは GSC実測 〜${jaDate(funnel.asOf)}` : undefined}
    >
      <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
        {funnel.rows.map((r, i) => {
          const isDrop = i === funnel.biggestDropIndex;
          const w = r.value !== null && max > 0 ? Math.max(8, (r.value / max) * 100) : 8;
          return (
            <div key={r.key} className="flex items-stretch gap-1.5">
              <div
                className={`flex min-w-[92px] flex-col rounded-lg border px-3 py-2.5 ${
                  isDrop
                    ? "border-[var(--bad)]/40 bg-[var(--bad)]/[0.05]"
                    : "border-[var(--border)] bg-[var(--panel-2)]"
                }`}
              >
                <div className="text-[11px] text-[var(--muted)]">{r.label}</div>
                <div className="mt-1">
                  {r.value === null ? (
                    <Unmeasured small />
                  ) : (
                    <span className="tnum text-lg font-bold leading-none">
                      {r.value.toLocaleString("ja-JP")}
                    </span>
                  )}
                </div>
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--border)]">
                  <div
                    className={`h-full rounded-full ${isDrop ? "bg-[var(--bad)]" : "bg-[var(--accent)]"}`}
                    style={{ width: `${w}%` }}
                  />
                </div>
              </div>
              {i < funnel.rows.length - 1 && (
                <div className="flex flex-col items-center justify-center px-0.5 text-[var(--faint)]">
                  <span>→</span>
                  {funnel.retention[i + 1] !== null && (
                    <span className="tnum text-[10px]">
                      {Math.round((funnel.retention[i + 1] as number) * 100)}%
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {funnel.biggestDropIndex !== null && (
        <p className="mt-3 text-[12px]">
          <span className="font-medium text-[var(--bad)]">最大ドロップ</span>
          <span className="text-[var(--muted)]">
            {" "}
            {funnel.rows[funnel.biggestDropIndex - 1]?.label} →{" "}
            {funnel.rows[funnel.biggestDropIndex]?.label}
          </span>
        </p>
      )}
      <p className="mt-1 text-[12px] text-[var(--faint)]">
        CTA表示以降は計測タグ（P2.5）を本番設置し計測開始を記録すると表示される。
      </p>
    </Panel>
  );
}

/* ─────────────────────────── 段5 ─────────────────────────── */

function NextActionsPanel({ stats }: { stats: ActionStats }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="mb-4 flex items-baseline gap-2.5">
        <span className="inline-flex h-5 items-center rounded-md bg-[var(--ink)] px-1.5 text-[11px] font-semibold text-white">
          段5
        </span>
        <h2 className="text-[15px] font-semibold">次の一手</h2>
        <Link
          href="/experiments"
          className="ml-auto text-[12px] text-[var(--accent)] hover:underline"
        >
          施策・PDCA を開く →
        </Link>
      </div>
      {stats.proposed > 0 ? (
        <div className="flex items-center gap-4">
          <div>
            <span className="tnum text-3xl font-bold text-[var(--accent)]">{stats.proposed}</span>
            <span className="ml-1.5 text-[13px] text-[var(--muted)]">件の承認待ち</span>
          </div>
          <Link
            href="/experiments"
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
          >
            承認する
          </Link>
          <span className="text-[12px] text-[var(--faint)]">
            実行中 {stats.approved}・完了 {stats.done}
          </span>
        </div>
      ) : (
        <p className="text-[13px] text-[var(--muted)]">
          承認待ちの提案はありません。
          <Link href="/experiments" className="ml-1 text-[var(--accent)] hover:underline">
            施策・PDCA
          </Link>
          で「立案を実行」すると、実測から改善案を起票します。
        </p>
      )}
    </section>
  );
}

/* ─────────────────────────── 段3 ─────────────────────────── */

function BuyerPanel({ buyer }: { buyer: Awaited<ReturnType<typeof getBuyerQuality>> }) {
  const tagged = buyer.taggedContentRatio;
  return (
    <Panel n={3} title="買い手の質">
      {tagged && tagged.tagged > 0 ? (
        <p className="text-sm">
          買い手軸タグ付け済み{" "}
          <span className="tnum font-bold">
            {tagged.tagged} / {tagged.total}
          </span>{" "}
          記事
        </p>
      ) : (
        <div>
          <Unmeasured />
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--faint)]">{buyer.note}</p>
        </div>
      )}
    </Panel>
  );
}

/* ─────────────────────────── 段7 ─────────────────────────── */

function HealthPanel({ health }: { health: Awaited<ReturnType<typeof getJobHealth>> }) {
  const style =
    health.gsc.alert === "red"
      ? "border-[var(--bad)]/40 bg-[var(--bad)]/[0.06] text-[var(--bad)]"
      : health.gsc.alert === "warn"
        ? "border-[var(--warn)]/40 bg-[var(--warn)]/[0.08] text-[#9a6a00]"
        : "border-[var(--ok)]/40 bg-[var(--ok)]/[0.08] text-[#1a7a2e]";

  const threadsStyle =
    health.threads.alert === "red"
      ? "border-[var(--bad)]/40 bg-[var(--bad)]/[0.06] text-[var(--bad)]"
      : health.threads.alert === "warn"
        ? "border-[var(--warn)]/40 bg-[var(--warn)]/[0.08] text-[#9a6a00]"
        : health.threads.alert === "unknown"
          ? "border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"
          : "border-[var(--ok)]/40 bg-[var(--ok)]/[0.08] text-[#1a7a2e]";

  return (
    <Panel n={7} title="ジョブ健全性・配信・欠測">
      <div className={`rounded-lg border px-3 py-2.5 text-[13px] leading-snug ${style}`}>
        {health.gsc.latestDate === null ? (
          "GSC 実測データがありません"
        ) : health.gsc.alert === "red" ? (
          <>
            GSC 日次が <strong className="tnum">{health.gsc.gapDays}日欠測</strong>
            <span className="opacity-70">（最終 {jaDate(health.gsc.latestDate)}）</span>
            <br />
            日次ジョブが止まっている。取得ジョブの登録が必要。
          </>
        ) : health.gsc.alert === "warn" ? (
          <>GSC 反映がやや遅れ（最終 {jaDate(health.gsc.latestDate)}）</>
        ) : (
          <>GSC 日次は最新（{jaDate(health.gsc.latestDate)}）</>
        )}
      </div>

      {/* ★配信停止の検知。ジョブの失敗と違い「動いていないこと」はエラーに残らない */}
      <div className={`mt-2 rounded-lg border px-3 py-2.5 text-[13px] leading-snug ${threadsStyle}`}>
        {health.threads.alert === "unknown" ? (
          <>Threads 投稿: {health.threads.reason}</>
        ) : health.threads.alert === "ok" ? (
          <>Threads 投稿は継続中（{health.threads.reason}）</>
        ) : (
          <>
            Threads 投稿が{" "}
            <strong className="tnum">{health.threads.gapDays}日 止まっています</strong>
            <span className="opacity-70">（最終 {jaDate(health.threads.lastPostedAt)}）</span>
            <br />
            {health.threads.reason}
          </>
        )}
      </div>

      <div className="mt-3">
        {health.jobs.length === 0 ? (
          <p className="text-[12px] text-[var(--faint)]">
            登録ジョブなし。worker は稼働中だが定期ジョブは未登録。
          </p>
        ) : (
          <ul className="grid gap-1.5">
            {health.jobs.map((j) => (
              <li key={j.name} className="flex items-center gap-2 text-[13px]">
                <span aria-hidden>
                  {j.lastStatus === "success" ? "🟢" : j.lastStatus === "failed" ? "🔴" : "⏳"}
                </span>
                <span className="font-mono text-[12px]">{j.name}</span>
                <span className="ml-auto text-[12px] text-[var(--faint)]">
                  {jaDateTime(j.lastRunAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
