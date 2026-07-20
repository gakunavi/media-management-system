import { auth, signOut } from "@/auth";
import { NOT_MEASURED, formatMeasured } from "@mms/shared";
import {
  currentPeriod,
  getGoals,
  getFunnel,
  getBuyerQuality,
  getJobHealth,
} from "@/lib/dashboard";

// ★石井さんが毎日見る唯一の画面（設計書 §4.1 段1〜段3・段7）。
//   段4「今週の変化」・段5「次の一手」・段6「施策の生死」は operator（P4）で追加する。
export const dynamic = "force-dynamic";

function fmtDate(d: Date | null): string {
  return d ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";
}

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
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">MMS ダッシュボード</h1>
          <p className="mt-0.5 text-sm text-neutral-500">
            {period}／メディア・SNS運用の獲得
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-neutral-500">
          <span>{session?.user?.email}</span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button className="rounded-md border border-neutral-300 px-2.5 py-1 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900">
              ログアウト
            </button>
          </form>
        </div>
      </header>

      {/* 段1: 獲得3ゴールの結果 */}
      <Panel n={1} title="結果（獲得3ゴール）">
        <ul className="space-y-3">
          {goals.map((g) => {
            const pct =
              g.actual !== null && g.target
                ? Math.min(100, Math.round((g.actual / g.target) * 100))
                : null;
            return (
              <li key={g.key} className="flex items-center gap-3 text-sm">
                <span className="w-40 shrink-0">{g.label}</span>
                <span className="w-24 shrink-0 font-semibold tabular-nums">
                  {g.actual === null ? (
                    <span className="text-amber-600">{NOT_MEASURED}</span>
                  ) : (
                    <>
                      {g.actual}
                      {g.target !== null && (
                        <span className="font-normal text-neutral-400">
                          {" "}
                          / {g.target}
                        </span>
                      )}
                    </>
                  )}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded bg-neutral-100 dark:bg-neutral-800">
                  {pct !== null && (
                    <div
                      className="h-full bg-neutral-800 dark:bg-neutral-300"
                      style={{ width: `${pct}%` }}
                    />
                  )}
                </div>
                <span className="w-16 shrink-0 text-right text-xs text-neutral-400">
                  {g.target === null ? "目標未設定" : pct !== null ? `${pct}%` : ""}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-xs text-neutral-400">
          ★計測開始前は 0 ではなく{" "}
          <span className="text-amber-600">{NOT_MEASURED}</span>{" "}
          と表示する（§3 規約）。WPフォーム接続後に計測が始まる。
        </p>
      </Panel>

      {/* 段2: ファネル */}
      <Panel n={2} title="ファネル（どこで落ちているか）">
        <div className="flex flex-wrap items-end gap-1 text-sm">
          {funnel.rows.map((r, i) => (
            <div key={r.key} className="flex items-end gap-1">
              <div className="rounded-md border border-neutral-200 px-3 py-2 text-center dark:border-neutral-800">
                <div className="text-[11px] text-neutral-500">{r.label}</div>
                <div className="font-semibold tabular-nums">
                  {r.value === null ? (
                    <span className="text-amber-600 text-xs">{NOT_MEASURED}</span>
                  ) : (
                    r.value.toLocaleString("ja-JP")
                  )}
                </div>
              </div>
              {i < funnel.rows.length - 1 && (
                <span className="pb-3 text-neutral-300">→</span>
              )}
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-neutral-400">
          表示・クリックは GSC 実測（〜{fmtDate(funnel.asOf)}）。
          CTA表示以降は自前計測タグ（P2.5）を本番設置し計測開始を記録すると出る。
        </p>
      </Panel>

      {/* 段3: 買い手の質 */}
      <Panel n={3} title="買い手の質">
        {buyer.taggedContentRatio && buyer.taggedContentRatio.tagged > 0 ? (
          <p className="text-sm">
            買い手軸タグ付け済み: {buyer.taggedContentRatio.tagged} /{" "}
            {buyer.taggedContentRatio.total} 記事
          </p>
        ) : (
          <p className="text-sm text-amber-600">
            {NOT_MEASURED}
            <span className="ml-2 text-xs text-neutral-400">{buyer.note}</span>
          </p>
        )}
      </Panel>

      {/* 段7: ジョブ健全性・欠測 */}
      <Panel n={7} title="ジョブ健全性・計測の欠測">
        <div
          className={`mb-3 rounded-md border px-3 py-2 text-sm ${
            health.gsc.alert === "red"
              ? "border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
              : health.gsc.alert === "warn"
                ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                : "border-green-300 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300"
          }`}
        >
          {health.gsc.latestDate === null ? (
            <>GSC 実測データがありません</>
          ) : health.gsc.alert === "red" ? (
            <>
              🔴 GSC 日次が <strong>{health.gsc.gapDays}日欠測</strong>（最終取得{" "}
              {fmtDate(health.gsc.latestDate)}）。日次ジョブが止まっている。
            </>
          ) : health.gsc.alert === "warn" ? (
            <>🟡 GSC 反映がやや遅れ（最終 {fmtDate(health.gsc.latestDate)}）</>
          ) : (
            <>🟢 GSC 日次は最新（{fmtDate(health.gsc.latestDate)}）</>
          )}
        </div>

        {health.jobs.length === 0 ? (
          <p className="text-sm text-neutral-500">
            登録ジョブなし。P1 の worker は稼働中だが定期ジョブは未登録。
          </p>
        ) : (
          <ul className="space-y-1 text-sm">
            {health.jobs.map((j) => (
              <li key={j.name} className="flex items-center gap-2">
                <span aria-hidden>
                  {j.lastStatus === "success"
                    ? "🟢"
                    : j.lastStatus === "failed"
                      ? "🔴"
                      : "⏳"}
                </span>
                <span className="font-mono text-xs">{j.name}</span>
                <span className="text-neutral-400">
                  {j.lastRunAt
                    ? j.lastRunAt.toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })
                    : "未実行"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <footer className="mt-8 rounded-lg border border-dashed border-neutral-300 p-4 text-xs text-neutral-500 dark:border-neutral-700">
        段4「今週の変化」・段5「次の一手」・段6「施策の生死」は{" "}
        <strong>P4（operator）</strong> で追加します。
        値の表示は必ず {NOT_MEASURED} と実測ゼロを区別しています（§3 規約）。
      </footer>
    </main>
  );
}

function Panel({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-5 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
      <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <span className="inline-flex h-5 w-8 items-center justify-center rounded bg-neutral-900 text-xs text-white dark:bg-neutral-100 dark:text-neutral-900">
          段{n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}
