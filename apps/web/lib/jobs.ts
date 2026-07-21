// ジョブ監視（設計書 §4.2 /jobs・§4.1 段7 ジョブ健全性）
import parser from "cron-parser";
import { prisma } from "@mms/db";

const TZ = "Asia/Tokyo"; // docs/RULES.md §9 全てJST

export type JobRow = {
  id: string;
  name: string;
  schedule: string;
  scheduleLabel: string;
  kind: string;
  enabled: boolean;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastStatus: string | null;
  lastLog: string | null;
  lastElapsedSeconds: number | null;
  successCount: number;
  failedCount: number;
};

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
    return {
      id: j.id,
      name: j.name,
      schedule: j.schedule,
      scheduleLabel: humanizeCron(j.schedule),
      kind: j.kind,
      enabled: j.enabled,
      nextRunAt: j.enabled ? nextRun(j.schedule) : null,
      lastRunAt: last?.startedAt ?? null,
      lastStatus: last?.status ?? null,
      lastLog: last?.log ?? null,
      lastElapsedSeconds: last ? elapsedOf(last.metrics) : null,
      successCount: c.success,
      failedCount: c.failed,
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
