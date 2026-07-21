// ダッシュボード集計（設計書 §4.1 段1〜段3・段7 / §3 欠測とゼロの区別）
//
// ★最重要の規約（docs/RULES.md §2）:
//   MeasurementCoverage に行が無い指標は「未計測」。決して 0 と表示しない。
//   この集計関数は「未計測」を null で返し、UI が "—(未計測)" と表示する。
import { prisma } from "@mms/db";
import { getToolAlerts } from "./tools";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 現在の対象月（"YYYY-MM"・JST基準） */
export function currentPeriod(now: Date = new Date()): string {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** その指標が「計測中」か（MeasurementCoverage に期間があるか・§3 規約） */
async function measuredMetrics(): Promise<Set<string>> {
  const rows = await prisma.measurementCoverage.findMany({ select: { metric: true } });
  return new Set(rows.map((r) => r.metric));
}

// ── 段1: 獲得3ゴールの結果 ──────────────────────────────────────
export type GoalRow = {
  key: "direct_inquiry" | "agency" | "line_friend";
  label: string;
  coverageMetric: string;
  /** null = 未計測。数値 = 実測 */
  actual: number | null;
  target: number | null;
};

export async function getGoals(period = currentPeriod()): Promise<GoalRow[]> {
  const measured = await measuredMetrics();

  const [leadCounts, targets] = await Promise.all([
    prisma.lead.groupBy({
      by: ["type"],
      _count: { _all: true },
      where: {
        occurredAt: {
          gte: new Date(`${period}-01T00:00:00+09:00`),
        },
      },
    }),
    prisma.target.findMany({ where: { period } }),
  ]);

  const countByType = new Map(leadCounts.map((r) => [r.type, r._count._all]));
  const targetByMetric = new Map(targets.map((t) => [t.metric, t.targetValue]));

  const defs: Omit<GoalRow, "actual" | "target">[] = [
    { key: "direct_inquiry", label: "① 直客の問い合わせ", coverageMetric: "lead_direct_inquiry" },
    { key: "agency", label: "② 代理店（有効DM）", coverageMetric: "lead_agency" },
    { key: "line_friend", label: "③ LINE登録", coverageMetric: "lead_line" },
  ];

  return defs.map((d) => ({
    ...d,
    // ★計測開始を記録していない指標は「未計測」（0 ではない）
    actual: measured.has(d.coverageMetric) ? (countByType.get(d.key) ?? 0) : null,
    target: targetByMetric.get(d.key) ?? null,
  }));
}

// ── 段2: ファネル ──────────────────────────────────────────────
export type FunnelRow = {
  key: string;
  label: string;
  value: number | null; // null = 未計測
  source: "gsc" | "funnel";
};

/** 直近 N 日の GSC 実測合計（MetricSnapshot = サイト全体） */
async function gscSum(metric: string, days: number): Promise<{ value: number; asOf: Date } | null> {
  const latest = await prisma.metricSnapshot.findFirst({
    where: { metric },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!latest) return null;
  const since = new Date(latest.date);
  since.setDate(since.getDate() - (days - 1));
  const agg = await prisma.metricSnapshot.aggregate({
    _sum: { value: true },
    where: { metric, date: { gte: since, lte: latest.date } },
  });
  return { value: Math.round(agg._sum.value ?? 0), asOf: latest.date };
}

async function funnelStepCount(step: string): Promise<number> {
  return prisma.funnelEvent.count({ where: { step: step as never } });
}

export type FunnelView = {
  rows: FunnelRow[];
  asOf: Date | null;
  /** 隣接段間の残存率（前段=100%基準）。null は未計測を含む区間 */
  retention: (number | null)[];
  /** 最大ドロップ地点の row index（§4.1「最大ドロップを明示」）。null=判定不可 */
  biggestDropIndex: number | null;
};

export async function getFunnel(): Promise<FunnelView> {
  const measured = await measuredMetrics();
  const funnelMeasured = measured.has("funnel");

  const [impr, clicks] = await Promise.all([
    gscSum("impressions", 28),
    gscSum("clicks", 28),
  ]);

  // CTA表示以降は自前計測（タグ）が動いていないと未計測
  const [ctaView, ctaClick, lpView, formView, submit] = funnelMeasured
    ? await Promise.all([
        funnelStepCount("cta_view"),
        funnelStepCount("cta_click"),
        funnelStepCount("lp_view"),
        funnelStepCount("form_view"),
        funnelStepCount("submit"),
      ])
    : [null, null, null, null, null];

  const rows: FunnelRow[] = [
    { key: "impressions", label: "表示", value: impr?.value ?? null, source: "gsc" },
    { key: "clicks", label: "クリック", value: clicks?.value ?? null, source: "gsc" },
    { key: "cta_view", label: "CTA表示", value: ctaView, source: "funnel" },
    { key: "cta_click", label: "CTAクリック", value: ctaClick, source: "funnel" },
    { key: "lp_view", label: "LP到達", value: lpView, source: "funnel" },
    { key: "form_view", label: "フォーム到達", value: formView, source: "funnel" },
    { key: "submit", label: "送信", value: submit, source: "funnel" },
  ];

  // 隣接段間の残存率と最大ドロップ地点
  const retention: (number | null)[] = [null];
  let biggestDropIndex: number | null = null;
  let worstRetention = Infinity;
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1].value;
    const cur = rows[i].value;
    if (prev !== null && cur !== null && prev > 0) {
      const r = cur / prev;
      retention.push(r);
      if (r < worstRetention) {
        worstRetention = r;
        biggestDropIndex = i;
      }
    } else {
      retention.push(null);
    }
  }
  return { rows, asOf: impr?.asOf ?? clicks?.asOf ?? null, retention, biggestDropIndex };
}

// ── 段3: 買い手の質 ────────────────────────────────────────────
export type BuyerQuality = {
  taggedContentRatio: { tagged: number; total: number } | null;
  note: string;
};

export async function getBuyerQuality(): Promise<BuyerQuality> {
  // budgetTier / funnelStage は P4.9 の一括タグ付けで埋まる。現状は未タグ。
  const [total, tagged] = await Promise.all([
    prisma.contentItem.count({ where: { type: "article" } }),
    prisma.contentItem.count({
      where: { type: "article", budgetTier: { not: "unknown" } },
    }),
  ]);
  return {
    taggedContentRatio: total > 0 ? { tagged, total } : null,
    note:
      tagged === 0
        ? "買い手軸（budgetTier / funnelStage）は未タグ付け。P4.9 で一括付与すると「買い手適合クリック」を算出できる"
        : "",
  };
}

// ── 段7: ジョブ健全性・欠測 ────────────────────────────────────
export type JobHealth = {
  jobs: { name: string; lastStatus: string | null; lastRunAt: Date | null }[];
  /** ★欠測アラート（§3.2.2）。最終計測日から今日までの空き日数 */
  gsc: { latestDate: Date | null; gapDays: number | null; alert: "ok" | "warn" | "red" };
  /** ★配信が止まっていないか（§5.4 即通知の対象）。実際に2日気づかれなかった */
  threads: ThreadsDelivery;
  /** ツールの残高不足・判定期日超過（/costs）。実際に残高が枯渇しかけた */
  tools: { kind: string; message: string }[];
  /** Threads Insights の回収が生きているか（cowork 日次 Step1 から移管） */
  insights: InsightsHealth;
};

/**
 * Insights の回収が止まっていないか。
 *
 * ★cowork の日次監視 Step1 が queue の insights_updated_at で見ていた項目。
 *   日次監視から配信チェックを外すにあたり、ここが空くと
 *   「投稿は出ているのに数字が入ってこない」状態に誰も気づけなくなる。
 *   投稿が出ていることと、その結果が測れていることは別の障害。
 *
 * ★24時間以内の投稿は対象外。GAS 側が「24h以上経過した投稿」だけを
 *   回収しているので、直後の未計測は正常（欠測ではない・§3）。
 */
export type InsightsHealth = {
  /** 25時間〜14日前の投稿のうち、views が1件も無いもの */
  unmeasured: number;
  target: number;
  alert: "ok" | "warn" | "red";
  reason: string;
};

/** 未計測がこの割合を超えたら回収が壊れていると見る */
const INSIGHTS_WARN_RATIO = 0.1;
const INSIGHTS_RED_RATIO = 0.3;

/**
 * Threads の配信が続いているか。
 *
 * ★なぜ要るか: 2026-07-21 時点で投稿が7/19から止まっていたのに、
 *   システムは誰にも知らせなかった。投稿が止まると獲得も、
 *   viewsPerFollower の基準線作りも同時に止まる。
 *   「動いていないこと」は放っておくと気づけない類の障害で、
 *   ジョブの失敗と違ってエラーログにも残らない。
 */
export type ThreadsDelivery = {
  lastPostedAt: Date | null;
  /** 最終投稿から今日までの空き日数 */
  gapDays: number | null;
  alert: "ok" | "warn" | "red" | "unknown";
  reason: string;
  /** 投稿キューの残り本数。null は「取れていない」で 0（空）とは別（§3） */
  queuePending: number | null;
};

/** 投稿が止まったとみなす日数。毎時トリガーで日次投稿している前提 */
const THREADS_STALL_WARN_DAYS = 2;
const THREADS_STALL_RED_DAYS = 3;

/**
 * キューの残り本数の閾値。
 *
 * ★空になってから気づく設計だと、気づいた時点で既に数日止まっている。
 *   配信は 13本/日（cowork の週次生成88本/週を収める枠数）なので、
 *   13本を「明日には切れる」、39本を「3日以内に切れる」と見る。
 */
const QUEUE_RED_POSTS = 13;
const QUEUE_WARN_POSTS = 39;

export async function getJobHealth(now: Date = new Date()): Promise<JobHealth> {
  const jobs = await prisma.job.findMany({
    include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } },
    orderBy: { name: "asc" },
  });

  const latest = await prisma.contentMetric.findFirst({
    where: { metric: "clicks" },
    orderBy: { date: "desc" },
    select: { date: true },
  });

  let gapDays: number | null = null;
  let alert: "ok" | "warn" | "red" = "ok";
  if (latest) {
    const today = new Date(now.getTime() + JST_OFFSET_MS);
    today.setUTCHours(0, 0, 0, 0);
    const l = new Date(latest.date);
    gapDays = Math.floor((today.getTime() - l.getTime()) / 86400000);
    // GSC は反映遅延2〜3日。それを超えたら警告、3日超で赤（§3.2.2）
    if (gapDays > 3) alert = "red";
    else if (gapDays >= 3) alert = "warn";
  }

  return {
    jobs: jobs.map((j) => ({
      name: j.name,
      lastStatus: j.runs[0]?.status ?? null,
      lastRunAt: j.runs[0]?.startedAt ?? null,
    })),
    gsc: { latestDate: latest?.date ?? null, gapDays, alert },
    threads: await getThreadsDelivery(now),
    tools: await getToolAlerts(now),
    insights: await getInsightsHealth(now),
  };
}

async function getInsightsHealth(now: Date): Promise<InsightsHealth> {
  const from = new Date(now.getTime() - 14 * 86400000);
  const to = new Date(now.getTime() - 25 * 3600000);
  const posts = await prisma.contentItem.findMany({
    where: {
      type: "post",
      channel: { type: "threads" },
      publishedAt: { gte: from, lt: to },
    },
    select: { id: true },
  });
  if (posts.length === 0) {
    // ★対象が無いのは「回収が壊れた」ではない。0件で赤にしない（§16.5）
    return { unmeasured: 0, target: 0, alert: "ok", reason: "判定対象の投稿がありません" };
  }

  const withMetric = await prisma.contentMetric.groupBy({
    by: ["contentItemId"],
    where: { metric: "threads_views", contentItemId: { in: posts.map((p) => p.id) } },
  });
  const unmeasured = posts.length - withMetric.length;
  const ratio = unmeasured / posts.length;

  if (ratio >= INSIGHTS_RED_RATIO) {
    return {
      unmeasured,
      target: posts.length,
      alert: "red",
      reason: `直近2週の投稿 ${posts.length}件のうち ${unmeasured}件が未計測。Insights の回収が止まっている可能性`,
    };
  }
  if (ratio >= INSIGHTS_WARN_RATIO) {
    return {
      unmeasured,
      target: posts.length,
      alert: "warn",
      reason: `直近2週の投稿 ${posts.length}件のうち ${unmeasured}件が未計測`,
    };
  }
  return {
    unmeasured,
    target: posts.length,
    alert: "ok",
    reason: `直近2週 ${posts.length}件中 ${unmeasured}件が未計測`,
  };
}

async function getThreadsDelivery(now: Date): Promise<ThreadsDelivery> {
  const last = await prisma.contentItem.findFirst({
    where: { type: "post", channel: { type: "threads" }, publishedAt: { not: null } },
    orderBy: { publishedAt: "desc" },
    select: { publishedAt: true },
  });

  // 直近に記録されたキュー残数（threads_sync が毎日更新する）
  const health = await prisma.snsAccountHealth.findFirst({
    where: { channel: { type: "threads" }, queuePending: { not: null } },
    orderBy: { date: "desc" },
    select: { queuePending: true },
  });
  const queuePending = health?.queuePending ?? null;

  if (!last?.publishedAt) {
    // ★1件も無いのは「止まった」ではなく「まだ同期していない」（§3）
    return {
      lastPostedAt: null,
      gapDays: null,
      alert: "unknown",
      reason: "投稿の同期がまだありません（止まっているとは限りません）",
      queuePending,
    };
  }

  const today = new Date(now.getTime() + JST_OFFSET_MS);
  today.setUTCHours(0, 0, 0, 0);
  const d = new Date(last.publishedAt.getTime() + JST_OFFSET_MS);
  d.setUTCHours(0, 0, 0, 0);
  const gapDays = Math.floor((today.getTime() - d.getTime()) / 86400000);

  // ★残数が分かっているときは、そちらを理由に添える。
  //   「止まりました」より「あと何本で切れます」の方が手が打てる。
  const stock =
    queuePending === null
      ? "キュー残数は不明（同期待ち）"
      : queuePending === 0
        ? "キューは空（在庫切れ）"
        : `キュー残り${queuePending}本`;

  if (gapDays >= THREADS_STALL_RED_DAYS) {
    return {
      lastPostedAt: last.publishedAt,
      gapDays,
      alert: "red",
      reason: `最終投稿から${gapDays}日。${stock}`,
      queuePending,
    };
  }
  if (gapDays >= THREADS_STALL_WARN_DAYS) {
    return {
      lastPostedAt: last.publishedAt,
      gapDays,
      alert: "warn",
      reason: `最終投稿から${gapDays}日。${stock}`,
      queuePending,
    };
  }

  // ★配信は続いているが在庫が細っている状態。ここで言えれば止まらずに済む
  if (queuePending !== null && queuePending <= QUEUE_RED_POSTS) {
    return {
      lastPostedAt: last.publishedAt,
      gapDays,
      alert: "red",
      reason: `${stock}。今の配信ペース（1日13本）だと明日には止まります`,
      queuePending,
    };
  }
  if (queuePending !== null && queuePending <= QUEUE_WARN_POSTS) {
    return {
      lastPostedAt: last.publishedAt,
      gapDays,
      alert: "warn",
      reason: `${stock}。3日以内に補充が要ります`,
      queuePending,
    };
  }

  return {
    lastPostedAt: last.publishedAt,
    gapDays,
    alert: "ok",
    reason: `最終投稿は${gapDays}日前・${stock}`,
    queuePending,
  };
}
