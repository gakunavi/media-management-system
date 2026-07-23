// ジョブ監視（設計書 §4.2 /jobs・§4.1 段7 ジョブ健全性）
import parser from "cron-parser";
import { prisma } from "@mms/db";

const TZ = "Asia/Tokyo"; // docs/RULES.md §9 全てJST

/**
 * ジョブの状態。
 *
 * ★「一度も動いていない」を一律に異常としない（2026-07-24）。
 *   週次ジョブ3本が実行0回だったが、登録が火曜・木曜で**最初の月曜がまだ来ていない**
 *   だけだった。これを赤で出すと、意味のない警告を毎日見ることになり、
 *   本物の停止が埋もれる。**待機中**と**予定を過ぎたのに動いていない**は別物。
 */
export type JobHealthState = "ok" | "failed" | "stalled" | "waiting" | "disabled";

export type JobRow = {
  id: string;
  name: string;
  schedule: string;
  scheduleLabel: string;
  kind: string;
  enabled: boolean;
  note: string | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastStatus: string | null;
  lastLog: string | null;
  lastElapsedSeconds: number | null;
  successCount: number;
  failedCount: number;
  health: JobHealthState;
  /** 予定を何回分ぶん過ぎているか（stalled のときだけ） */
  missedRuns: number;
};

export const JOB_HEALTH_LABEL: Record<JobHealthState, string> = {
  ok: "正常",
  failed: "失敗",
  stalled: "止まっている",
  waiting: "初回待ち",
  disabled: "停止中",
};

/**
 * 予定を過ぎたのに動いていないか。
 *
 * ★遅れを許す幅を取る。worker のポーリング間隔（既定20秒）と実行時間があるので、
 *   予定ちょうどには走らない。1回分の猶予では厳しすぎるため、
 *   **直近の予定より前にしか実行記録が無い**ものだけを止まっていると見なす。
 */
function missedSince(
  expr: string,
  lastRunAt: Date | null,
  createdAt: Date,
  now: Date,
): number {
  // ★起点は「最終実行」。無ければ「登録日」。
  //   登録日を下限にしないと、一度も動いていないジョブで遡り続けてしまう
  //   （実測: 未実行の週次3本が「予定29回分」と出た。実際は登録の翌月曜がまだ来ていない）。
  const since = lastRunAt ?? createdAt;
  try {
    const it = parser.parseExpression(expr, { tz: TZ, currentDate: now });
    let missed = 0;
    for (let i = 0; i < 60; i += 1) {
      const prev = it.prev().toDate();
      if (prev <= since) break;
      missed += 1;
    }
    // ★1回分は猶予。worker のポーリング間隔と実行時間があり、予定ちょうどには走らない
    return Math.max(0, missed - 1);
  } catch {
    return 0;
  }
}

const DOW = ["日", "月", "火", "水", "木", "金", "土"];

/** cron 式を日本語に（よくある形だけ。読めない形はそのまま返す） */
export function humanizeCron(expr: string): string {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = p;
  const time =
    /^\d+$/.test(min) && /^\d+$/.test(hour)
      ? `${hour.padStart(2, "0")}:${min.padStart(2, "0")}`
      : null;

  if (dom === "*" && mon === "*" && dow === "*" && time) return `毎日 ${time}`;
  if (dom === "*" && mon === "*" && /^\d$/.test(dow) && time)
    return `毎週${DOW[Number(dow)]}曜 ${time}`;
  if (min === "*" && hour === "*") return "毎分";
  if (dom === "*" && mon === "*" && dow === "*" && /^\d+$/.test(min) && hour === "*")
    return `毎時 ${min}分`;
  return expr;
}

function nextRun(expr: string): Date | null {
  try {
    return parser.parseExpression(expr, { tz: TZ }).next().toDate();
  } catch {
    return null;
  }
}

function elapsedOf(metrics: unknown): number | null {
  if (metrics && typeof metrics === "object") {
    const v = (metrics as Record<string, unknown>).elapsedSeconds;
    if (typeof v === "number") return Math.round(v * 100) / 100;
  }
  return null;
}

export async function getJobs(): Promise<JobRow[]> {
  const now = new Date();
  const jobs = await prisma.job.findMany({
    orderBy: { name: "asc" },
    include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } },
  });

  const counts = await prisma.jobRun.groupBy({
    by: ["jobId", "status"],
    _count: { _all: true },
  });
  const countBy = new Map<string, { success: number; failed: number }>();
  for (const c of counts) {
    const cur = countBy.get(c.jobId) ?? { success: 0, failed: 0 };
    if (c.status === "success") cur.success += c._count._all;
    else if (c.status === "failed") cur.failed += c._count._all;
    countBy.set(c.jobId, cur);
  }

  return jobs.map((j) => {
    const last = j.runs[0];
    const c = countBy.get(j.id) ?? { success: 0, failed: 0 };
    const missed = j.enabled
      ? missedSince(j.schedule, last?.startedAt ?? null, j.createdAt, now)
      : 0;
    // ★判定の順番が意味を持つ。停止中は「意図して止めた」ので他より先に見る
    const health: JobHealthState = !j.enabled
      ? "disabled"
      : last?.status === "failed"
        ? "failed"
        : missed > 0
          ? "stalled"
          : last
            ? "ok"
            : "waiting"; // 一度も動いていないが、まだ予定時刻が来ていない
    return {
      id: j.id,
      name: j.name,
      schedule: j.schedule,
      scheduleLabel: humanizeCron(j.schedule),
      kind: j.kind,
      enabled: j.enabled,
      note: j.note,
      nextRunAt: j.enabled ? nextRun(j.schedule) : null,
      lastRunAt: last?.startedAt ?? null,
      lastStatus: last?.status ?? null,
      lastLog: last?.log ?? null,
      lastElapsedSeconds: last ? elapsedOf(last.metrics) : null,
      successCount: c.success,
      failedCount: c.failed,
      health,
      missedRuns: missed,
    };
  });
}

export type RunRow = {
  id: string;
  jobName: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  log: string | null;
  elapsedSeconds: number | null;
};

export async function getRecentRuns(limit = 30): Promise<RunRow[]> {
  const runs = await prisma.jobRun.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
    include: { job: { select: { name: true } } },
  });
  return runs.map((r) => ({
    id: r.id,
    jobName: r.job.name,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    status: r.status,
    log: r.log,
    elapsedSeconds: elapsedOf(r.metrics),
  }));
}
