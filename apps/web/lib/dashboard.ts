// ダッシュボード集計（設計書 §4.1 段1〜段3・段7 / §3 欠測とゼロの区別）
//
// ★最重要の規約（docs/RULES.md §2）:
//   MeasurementCoverage に行が無い指標は「未計測」。決して 0 と表示しない。
//   この集計関数は「未計測」を null で返し、UI が "—(未計測)" と表示する。
import { prisma } from "@mms/db";

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

export async function getFunnel(): Promise<{ rows: FunnelRow[]; asOf: Date | null }> {
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
  return { rows, asOf: impr?.asOf ?? clicks?.asOf ?? null };
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
};

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
  };
}
