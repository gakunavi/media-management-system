import { getJobs, getRecentRuns, type JobRow } from "@/lib/jobs";
import { getMetricFreshness, type MetricFreshness } from "@/lib/dashboard";
import { JOB_HEALTH_LABEL } from "@/lib/jobs";
import { JobControls } from "./job-controls";

// ジョブ監視（設計書 §4.2 /jobs・§4.1 段7）
export const dynamic = "force-dynamic";

const jaDateTime = (d: Date | null) =>
  d
    ? d.toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

function statusMark(s: string | null): string {
  if (s === "success") return "🟢";
  if (s === "failed") return "🔴";
  if (s === "running") return "🔄";
  return "⏳";
}

export default async function JobsPage() {
  const [jobs, runs, freshness] = await Promise.all([
    getJobs(),
    getRecentRuns(),
    getMetricFreshness(),
  ]);
  // ★出すのは「気づくべき件数」。有効数を出しても打ち手にならない。
  //   停止中は意図して止めたものなので警告に混ぜない（混ぜると常時赤になる）。
  const stalled = jobs.filter((j) => j.health === "stalled");
  const failed = jobs.filter((j) => j.health === "failed");
  const waiting = jobs.filter((j) => j.health === "waiting");
  const disabled = jobs.filter((j) => j.health === "disabled");
  // 問題のあるものを先頭に出す（21枚を目で追わせない）
  const order: Record<string, number> = { stalled: 0, failed: 1, waiting: 2, ok: 3, disabled: 4 };
  const sorted = [...jobs].sort(
    (a, b) => (order[a.health] ?? 9) - (order[b.health] ?? 9) || a.name.localeCompare(b.name),
  );

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">ジョブ</h1>
        <p className="mt-0.5 text-[13px] text-[var(--muted)]">
          worker が自動実行する定期処理（§5.1）。失敗は段7にも出る
        </p>
      </div>

      <div className="mb-2 grid gap-3 sm:grid-cols-4">
        <Stat
          label="止まっている"
          value={stalled.length}
          tone={stalled.length > 0 ? "bad" : "ok"}
        />
        <Stat label="失敗" value={failed.length} tone={failed.length > 0 ? "bad" : "ok"} />
        <Stat label="初回待ち" value={waiting.length} />
        <Stat label="停止中（意図的）" value={disabled.length} />
      </div>
      <p className="mb-4 text-[12px] text-[var(--faint)]">
        ★<strong>「一度も動いていない」を異常にしない</strong>。週次ジョブは登録した曜日に
        よって最初の予定がまだ来ていないことがあり（実測: 火・木に登録した3本の初回は翌月曜）、
        これを赤で出すと意味のない警告を毎日見ることになる。
        <strong>「予定を過ぎたのに動いていない」だけを「止まっている」</strong>とする。
        停止中は意図して止めたものなので警告に混ぜない。
      </p>

      {/* ジョブ一覧 */}
      <section className="mb-6 grid gap-3">
        {jobs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--panel)] p-8 text-center text-[13px] text-[var(--faint)]">
            登録ジョブがありません。<code className="font-mono">npm run seed:jobs</code> で
            立案（週次）・判定（日次）を登録します。
          </div>
        ) : (
          sorted.map((j) => <JobCard key={j.id} job={j} />)
        )}
      </section>

      {/* 実行履歴 */}
      <section>
        <h2 className="mb-3 text-[15px] font-semibold">実行履歴（直近 {runs.length}件）</h2>
        {runs.length === 0 ? (
          <p className="text-[13px] text-[var(--faint)]">まだ実行履歴がありません。</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                    <th className="px-3 py-2 font-medium">開始</th>
                    <th className="px-3 py-2 font-medium">ジョブ</th>
                    <th className="px-3 py-2 font-medium">結果</th>
                    <th className="px-3 py-2 text-right font-medium">所要</th>
                    <th className="px-3 py-2 font-medium">ログ</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="whitespace-nowrap px-3 py-2.5 text-[var(--muted)]">
                        {jaDateTime(r.startedAt)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-[12px]">
                        {r.jobName}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {statusMark(r.status)} {r.status}
                      </td>
                      <td className="tnum whitespace-nowrap px-3 py-2.5 text-right text-[var(--muted)]">
                        {r.elapsedSeconds === null ? "—" : `${r.elapsedSeconds}s`}
                      </td>
                      <td
                        className="max-w-[380px] truncate px-3 py-2.5 text-[12px] text-[var(--faint)]"
                        title={r.log ?? ""}
                      >
                        {r.log ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      <MetricFreshnessPanel rows={freshness} />

      <p className="mt-3 text-[12px] text-[var(--faint)]">
        既存 Python 資産（GSC取得等）は
        <code className="mx-1 font-mono">kind=script</code>
        として登録すれば worker が実行します。★資格情報を worker に渡してから有効化すること
        （未設定のまま有効にすると失敗が段7を埋める）。
      </p>
    </div>
  );
}

/**
 * 指標の鮮度。
 *
 * ★なぜ要るか: 2026-07-22 の点検で、全ジョブ success なのに pv が
 *   9日間更新されていなかった。段7 は「ジョブが緑か」しか見ておらず、
 *   「そのジョブが書くはずのデータが増えているか」を見ていなかった。
 *   さらに weekly_* 6指標（各572行）は貯まっているのにアプリのどこからも
 *   読まれていなかった。集めることと使うことは別で、両方を出す。
 */
function MetricFreshnessPanel({ rows }: { rows: MetricFreshness[] }) {
  if (rows.length === 0) return null;
  const stale = rows.filter((r) => r.alert !== "ok");
  const unused = rows.filter((r) => !r.used);

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[14px] font-semibold">指標の鮮度</h2>
      <p className="mb-2 text-[12px] text-[var(--faint)]">
        ジョブが成功していても、書くはずのデータが入っていないことがある。
        ★「最終」が止まっている指標は、ジョブの緑では気づけない。
        ★「通常間隔」は履歴から推定した更新間隔で、その3倍を超えると警告する
        （日次なら3日、週次なら21日）。閾値を人が指標ごとに決めると、
        知らない指標を守れない。
      </p>
      {(stale.length > 0 || unused.length > 0) && (
        <p className="mb-2 rounded-md bg-[var(--warn)]/12 px-3 py-2 text-[12px] text-[#9a6a00]">
          {stale.length > 0 && <>更新が遅れている指標 {stale.length}件</>}
          {stale.length > 0 && unused.length > 0 && " / "}
          {unused.length > 0 && <>使われていない指標 {unused.length}件</>}
        </p>
      )}
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                <th className="whitespace-nowrap px-3 py-2 font-medium">指標</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">行数</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">最終</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">通常間隔</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">経過</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">利用</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.metric} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-3 py-2 font-mono text-[12px]">{r.metric}</td>
                  <td className="tnum px-3 py-2 text-right text-[var(--muted)]">
                    {r.rows.toLocaleString("ja-JP")}
                  </td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right text-[var(--muted)]">
                    {r.lastDate.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-[var(--faint)]">
                    {r.intervalDays === null ? "—" : `${r.intervalDays}日`}
                  </td>
                  <td
                    className={`tnum px-3 py-2 text-right ${
                      r.alert === "red"
                        ? "font-medium text-[var(--bad)]"
                        : r.alert === "warn"
                          ? "font-medium text-[#9a6a00]"
                          : "text-[var(--muted)]"
                    }`}
                  >
                    {r.ageDays}日
                  </td>
                  <td className="px-3 py-2 text-[12px]">
                    {r.used ? (
                      <span className="text-[var(--muted)]">画面で使用</span>
                    ) : (
                      <span className="text-[var(--bad)]">未使用</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

const HEALTH_MARK: Record<string, string> = {
  ok: "🟢",
  failed: "🔴",
  stalled: "🚨",
  waiting: "⏳",
  disabled: "⏸",
};

function JobCard({ job }: { job: JobRow }) {
  const bad = job.health === "failed" || job.health === "stalled";
  return (
    <div
      className={`rounded-xl border bg-[var(--panel)] p-4 ${
        bad ? "border-[var(--bad)]/40" : "border-[var(--border)]"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span aria-hidden>{HEALTH_MARK[job.health] ?? "🟢"}</span>
            <span className="font-mono text-[13px] font-medium">{job.name}</span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                bad
                  ? "bg-[var(--bad)]/15 font-medium text-[var(--bad)]"
                  : "bg-[var(--panel-2)] text-[var(--muted)]"
              }`}
            >
              {JOB_HEALTH_LABEL[job.health]}
              {job.health === "stalled" && `（予定${job.missedRuns}回分）`}
            </span>
            <span className="rounded bg-[var(--accent-weak)] px-1.5 py-0.5 text-[10px] text-[var(--accent)]">
              {job.kind}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-[var(--muted)]">
            <span>
              スケジュール: <strong>{job.scheduleLabel}</strong>
              <span className="ml-1 font-mono text-[11px] text-[var(--faint)]">
                {job.schedule}
              </span>
            </span>
            <span>次回: {jaDateTime(job.nextRunAt)}</span>
            <span>
              最終: {job.lastRunAt ? jaDateTime(job.lastRunAt) : "まだ実行なし"}
            </span>
            <span className="text-[var(--faint)]">
              成功 {job.successCount} / 失敗 {job.failedCount}
            </span>
          </div>
          {/* ★停止理由・用途を先に出す。無いと「直すべき障害」に見えて、
              誰かが再有効化して同じ失敗を繰り返す（aio-* は OpenAI クォータ枯渇で意図的に停止） */}
          {job.note && (
            <p className="mt-1.5 rounded bg-[var(--panel-2)] px-2 py-1 text-[11px] text-[var(--muted)]">
              {job.note}
            </p>
          )}
          {job.lastLog && (
            <p
              className={`mt-1.5 max-w-[520px] truncate text-[11px] ${bad ? "text-[var(--bad)]" : "text-[var(--faint)]"}`}
              title={job.lastLog}
            >
              {job.lastLog}
            </p>
          )}
        </div>
        <JobControls jobId={job.id} enabled={job.enabled} />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  tone,
}: {
  label: string;
  value: number;
  accent?: boolean;
  tone?: "ok" | "bad";
}) {
  const color = accent
    ? "text-[var(--accent)]"
    : tone === "bad"
      ? "text-[var(--bad)]"
      : tone === "ok"
        ? "text-[#1a7a2e]"
        : "";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
      <div className="text-[12px] text-[var(--muted)]">{label}</div>
      <div className={`tnum mt-1 text-2xl font-bold leading-none ${color}`}>{value}</div>
    </div>
  );
}
