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
export type JobHealthState = "ok" | "failed" | "aborted" | "stalled" | "waiting" | "disabled";

export type JobRow = {
  id: string;
  name: string;
  schedule: string;
  scheduleLabel: string;
  kind: string;
  enabled: boolean;
  note: string | null;
  /** 何のための処理か（日本語） */
  purpose: string | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastStatus: string | null;
  lastLog: string | null;
  lastElapsedSeconds: number | null;
  successCount: number;
  failedCount: number;
  health: JobHealthState;
  /** 予定を何回分過ぎているか（stalled のときだけ） */
  missedRuns: number;
};

export const JOB_HEALTH_LABEL: Record<JobHealthState, string> = {
  ok: "動いている",
  failed: "失敗",
  aborted: "中断（再起動）",
  stalled: "止まっている",
  waiting: "初回待ち",
  disabled: "止めている",
};

/**
 * 何のための処理かを日本語で言う。
 * ★「ジョブ名」だけでは何が起きるか分からない。`gsc-fetch-daily` を見ても
 *   「検索の実測が毎日入る」とは読めず、止まっていても重大さが判断できない。
 */
export const JOB_PURPOSE: Record<string, string> = {
  "gsc-fetch-daily": "検索の実測（表示・クリック・順位）を毎日取り込む",
  "gsc-queries-weekly": "記事が実際に来ている検索語を取り込む",
  "ga4-fetch-daily": "PV を毎日取り込む",
  "wp-sync-daily": "WordPress の記事一覧を取り込む",
  "threads-sync-daily": "Threads の投稿と実績を取り込む",
  "line-followers-daily": "公式LINEの友だち数を取り込む",
  "agency-lp-import-daily": "代理店LPの訪問・問い合わせを取り込む",
  "dm-log-import-daily": "Threads の DM 記録を取り込む",
  "rakko-import-daily": "ラッコのKW調査結果を取り込む",
  "serp-fetch-weekly": "検索結果の順位を取り込む（DataForSEO）",
  "url-health-daily": "記事URLが本当に開けるか確認する（301ループ・404）",
  "ledger-check-daily": "台帳・設定・実公開のズレを検出する",
  "tag-delivery-daily": "計測タグが読者に届いているか確認する",
  "jsonld-health-daily": "検索エンジン向けの構造化データが壊れていないか確認する",
  "uptime-check-5min": "サイトと問い合わせの受口が生きているか確認する",
  "telemetry-volume-hourly": "計測タグの発火が増えすぎていないか確認する",
  "page-experience-daily": "記事の表示速度を測る（スマホ・PC別）",
  "tool-balance-daily": "外部ツールの残高を確認する",
  "queue-refill-daily": "Threads の投稿キューを補充する",
  "intervention-evaluate-daily": "打ち手の効果を28日後に判定する",
  "health-alert-daily": "異常をまとめて通知する",
  "ideas-collect-weekly": "記事ネタを集める",
  "operator-propose-weekly": "次の打ち手を提案する",
  "aio-hot-weekly": "AI検索（ChatGPT）に引用されているか測る（主戦場KW）",
  "aio-warm-biweekly": "AI検索に引用されているか測る（中位KW）",
  "aio-cold-monthly": "AI検索に引用されているか測る（下位KW）",
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
        : // ★中断は失敗ではない。デプロイで打ち切られただけで、次回の予定で再実行される。
          //   失敗に混ぜると、イメージを作り直すたびに失敗件数が増えて信用できなくなる
          last?.status === "aborted" && missed === 0
          ? "aborted"
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
      purpose: JOB_PURPOSE[j.name] ?? null,
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
