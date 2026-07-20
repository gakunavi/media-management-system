import { auth, signOut } from "@/auth";
import { NOT_MEASURED } from "@mms/shared";
import {
  currentPeriod,
  getGoals,
  getFunnel,
  getBuyerQuality,
  getJobHealth,
  type GoalRow,
} from "@/lib/dashboard";

// ★石井さんが毎日見る唯一の画面（設計書 §4.1 段1〜段3・段7）。
//   段4「今週の変化」・段5「次の一手」・段6「施策の生死」は operator（P4）で追加する。
export const dynamic = "force-dynamic";

const jaDate = (d: Date | null) =>
  d ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }) : "—";
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
  const session = await auth();
  const period = currentPeriod();
  const [goals, funnel, buyer, health] = await Promise.all([
    getGoals(period),
    getFunnel(),
    getBuyerQuality(),
    getJobHealth(),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-5 py-8 sm:px-8">
      {/* ヘッダー */}
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-5">
        <div>
          <h1 className="text-lg font-bold tracking-tight">MMS ダッシュボード</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            {period.replace("-", "年")}月 ・ メディア／SNS運用の獲得
          </p>
        </div>
        <div className="flex items-center gap-3 text-[13px] text-[var(--muted)]">
          <span className="hidden sm:inline">{session?.user?.email}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button className="rounded-md border border-[var(--border)] px-2.5 py-1 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]">
              ログアウト
            </button>
          </form>
        </div>
      </header>

      <div className="grid gap-4">
        <GoalsPanel goals={goals} />
        <FunnelPanel funnel={funnel} />
        <div className="grid gap-4 sm:grid-cols-2">
          <BuyerPanel buyer={buyer} />
          <HealthPanel health={health} />
        </div>
      </div>

      <p className="mt-6 text-center text-[12px] text-[var(--faint)]">
        段4「今週の変化」・段5「次の一手」・段6「施策の生死」は P4（operator）で追加。
        すべての値は <span className="text-amber-600 dark:text-amber-500">{NOT_MEASURED}</span> と実測ゼロを区別しています（§3 規約）。
      </p>
    </main>
  );
}

/* ─────────────────────────── 共通パーツ ─────────────────────────── */

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
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-sm">
      <div className="mb-4 flex items-baseline gap-2.5">
        <span className="inline-flex h-5 items-center rounded-md bg-[var(--ink)] px-1.5 text-[11px] font-semibold text-[var(--panel)]">
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
    <span className={`text-amber-600 dark:text-amber-500 ${small ? "text-xs" : ""}`}>
      {NOT_MEASURED}
    </span>
  );
}

/* ─────────────────────────── 段1 ─────────────────────────── */

function GoalsPanel({ goals }: { goals: GoalRow[] }) {
  return (
    <Panel n={1} title="結果（獲得3ゴール）" hint="最優先＝直客">
      <div className="grid gap-2.5">
        {goals.map((g) => {
          const pct =
            g.actual !== null && g.target
              ? Math.min(100, Math.round((g.actual / g.target) * 100))
              : null;
          const dot =
            g.actual === null
              ? "bg-amber-400"
              : pct !== null && pct >= 100
                ? "bg-green-500"
                : pct !== null && pct >= 50
                  ? "bg-amber-400"
                  : "bg-red-400";
          return (
            <div
              key={g.key}
              className="flex items-center gap-3 rounded-lg border border-[var(--border)] px-3.5 py-3"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
              <span className="w-40 shrink-0 text-[13px]">{g.label}</span>
              <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
                {g.actual === null ? (
                  <Unmeasured />
                ) : (
                  <span className="tnum text-2xl font-bold leading-none">{g.actual}</span>
                )}
                {g.target !== null && (
                  <span className="tnum text-[13px] text-[var(--faint)]">/ {g.target}件</span>
                )}
              </div>
              <div className="hidden w-40 sm:block">
                <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
                  {pct !== null && (
                    <div
                      className="h-full rounded-full bg-[var(--ink)]"
                      style={{ width: `${pct}%` }}
                    />
                  )}
                </div>
              </div>
              <span className="tnum w-16 shrink-0 text-right text-[12px] text-[var(--faint)]">
                {g.target === null ? "目標未設定" : pct !== null ? `${pct}%` : ""}
              </span>
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

function FunnelPanel({
  funnel,
}: {
  funnel: Awaited<ReturnType<typeof getFunnel>>;
}) {
  const measuredValues = funnel.rows
    .map((r) => r.value)
    .filter((v): v is number => v !== null);
  const max = measuredValues.length ? Math.max(...measuredValues) : 0;

  return (
    <Panel
      n={2}
      title="ファネル（どこで落ちているか）"
      hint={funnel.asOf ? `表示・クリックは GSC実測 〜${jaDate(funnel.asOf)}` : undefined}
    >
      <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
        {funnel.rows.map((r, i) => {
          const isDrop = i === funnel.biggestDropIndex;
          const ret = funnel.retention[i];
          const barH =
            r.value !== null && max > 0
              ? Math.max(6, Math.round((r.value / max) * 56))
              : 6;
          return (
            <div key={r.key} className="flex items-stretch gap-1.5">
              <div
                className={`flex min-w-[86px] flex-col justify-between rounded-lg border px-2.5 py-2 ${
                  isDrop
                    ? "border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/40"
                    : "border-[var(--border)]"
                }`}
              >
                <div className="text-[11px] text-[var(--muted)]">{r.label}</div>
                <div className="mt-1 flex items-end justify-between gap-1">
                  <div>
                    {r.value === null ? (
                      <Unmeasured small />
                    ) : (
                      <span className="tnum text-lg font-bold leading-none">
                        {r.value.toLocaleString("ja-JP")}
                      </span>
                    )}
                  </div>
                </div>
                {/* 相対量のミニバー */}
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
                  <div
                    className={`h-full rounded-full ${isDrop ? "bg-red-400" : "bg-[var(--ink)]"}`}
                    style={{ width: `${(barH / 56) * 100}%` }}
                  />
                </div>
              </div>
              {i < funnel.rows.length - 1 && (
                <div className="flex flex-col items-center justify-center px-0.5">
                  <span className="text-[var(--faint)]">→</span>
                  {ret !== null && funnel.retention[i + 1] !== null && (
                    <span className="tnum text-[10px] text-[var(--faint)]">
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
          <span className="font-medium text-red-600 dark:text-red-400">最大ドロップ</span>
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

/* ─────────────────────────── 段3 ─────────────────────────── */

function BuyerPanel({
  buyer,
}: {
  buyer: Awaited<ReturnType<typeof getBuyerQuality>>;
}) {
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
          <p className="mt-2 text-[12px] leading-relaxed text-[var(--faint)]">
            {buyer.note}
          </p>
        </div>
      )}
    </Panel>
  );
}

/* ─────────────────────────── 段7 ─────────────────────────── */

function HealthPanel({
  health,
}: {
  health: Awaited<ReturnType<typeof getJobHealth>>;
}) {
  const alertStyle =
    health.gsc.alert === "red"
      ? "border-red-300 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
      : health.gsc.alert === "warn"
        ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300"
        : "border-green-300 bg-green-50 text-green-700 dark:border-green-900/60 dark:bg-green-950/40 dark:text-green-300";

  return (
    <Panel n={7} title="ジョブ健全性・欠測">
      <div className={`rounded-lg border px-3 py-2.5 text-[13px] leading-snug ${alertStyle}`}>
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
