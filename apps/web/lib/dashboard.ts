// ダッシュボード集計（設計書 §4.1 段1〜段3・段7 / §3 欠測とゼロの区別）
//
// ★最重要の規約（docs/RULES.md §2）:
//   MeasurementCoverage に行が無い指標は「未計測」。決して 0 と表示しない。
//   この集計関数は「未計測」を null で返し、UI が "—(未計測)" と表示する。
import { prisma } from "@mms/db";
import { getToolAlerts } from "./tools";
import { SOURCE_COVERAGE, SOURCE_LABEL, SOURCE_ORDER } from "./leads";
import { buildFlow, type Stage, type StageFlow } from "./stages";
import { jstDayKey, dayKeys, type Range } from "./period";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** その指標が「計測中」か（MeasurementCoverage に期間があるか・§3 規約） */
async function measuredMetrics(): Promise<Set<string>> {
  const rows = await prisma.measurementCoverage.findMany({ select: { metric: true } });
  return new Set(rows.map((r) => r.metric));
}

// ── 段1: 結果（問い合わせ = このシステムのゴール）────────────────
//
// ★何を「結果」と呼ぶかを、送客×受け皿の整理（2026-07-22）に合わせて直した。
//   旧実装は Lead.type（直客/代理店/LINE）の3ゴールだけを出していて、
//   受け皿（診断LP・代理店LP・HPフォーム・電話・info メール…）が
//   ひとつも見えなかった。増やしたいのは問い合わせの数で、
//   打ち手は受け皿ごとに違う。だから受け皿別に出す。
//
// ★LINE登録は「問い合わせ」ではない。登録は受け皿への到達であって、
//   まだ相談ではない。合算するとゴールの数字が水増しされるので分けて出す。
//
// ★計測が始まっていない受け皿は 0 ではなく未計測（§3）。
//   「問い合わせが来ていない」のと「来ても記録されない」は別の問題で、
//   打ち手も別（前者は集客、後者は計装）。

export type ReceiverRow = {
  key: string;
  label: string;
  /**
   * 問い合わせ件数。null = その受け皿の計測が始まっていない（§3）。
   * ★LINE登録は含めない。同じ公式LINEでも「登録した人」と
   *   「相談してきた人」は別の数字で、後者だけがゴールに効く。
   */
  inquiries: number | null;
  /** 前期間の問い合わせ件数。増減の比較用。未計測なら null */
  prevInquiries: number | null;
  /** 登録（LINE友だち追加）。登録という概念が無い受け皿は null */
  registrations: number | null;
  won: number;
  wonAmount: number;
  measured: boolean;
};

export type TypeRow = {
  key: string;
  label: string;
  value: number;
  target: number | null;
};

export type ResultView = {
  /** 問い合わせ（LINE登録を除く）。ゴールそのもの */
  inquiries: { value: number; prev: number; target: number | null };
  /** LINE登録。問い合わせの手前の受け皿到達 */
  registrations: { value: number | null; prev: number | null };
  won: { count: number; amount: number; prevCount: number };
  receivers: ReceiverRow[];
  /** 直客 / 代理店（旧 Lead.type。月次目標がこの粒度で入っている） */
  byType: TypeRow[];
  /** 目標と比べられる期間か（暦月と一致するか） */
  targetComparable: boolean;
};

type LeadSlim = {
  type: string;
  sourceType: string;
  status: string;
  closedAmount: unknown;
};

const amountOf = (v: unknown) => (v ? Number(v) : 0);

export async function getResult(range: Range): Promise<ResultView> {
  const [cur, prev, targets, coverages] = await Promise.all([
    prisma.lead.findMany({
      where: { occurredAt: { gte: range.since, lt: range.until } },
      select: { type: true, sourceType: true, status: true, closedAmount: true },
    }),
    prisma.lead.findMany({
      where: { occurredAt: { gte: range.prev.since, lt: range.prev.until } },
      select: { type: true, sourceType: true, status: true, closedAmount: true },
    }),
    range.period
      ? prisma.target.findMany({ where: { period: range.period } })
      : Promise.resolve([]),
    prisma.measurementCoverage.findMany({ select: { metric: true } }),
  ]);

  const covered = new Set(coverages.map((c) => c.metric));
  const targetOf = (metric: string) => targets.find((t) => t.metric === metric)?.targetValue ?? null;

  const bySource = (rows: LeadSlim[]) => {
    const m = new Map<string, { inquiries: number; registrations: number; won: number; amount: number }>();
    for (const r of rows) {
      const a = m.get(r.sourceType) ?? { inquiries: 0, registrations: 0, won: 0, amount: 0 };
      // ★登録（line_friend）と問い合わせを混ぜない
      if (r.type === "line_friend") a.registrations += 1;
      else a.inquiries += 1;
      if (r.status === "won") {
        a.won += 1;
        a.amount += amountOf(r.closedAmount);
      }
      m.set(r.sourceType, a);
    }
    return m;
  };

  const curBySource = bySource(cur as LeadSlim[]);
  const prevBySource = bySource(prev as LeadSlim[]);

  // ★旧値（lp_form / email）の行が残っていたら末尾に出す。黙って落とすと合計が合わない
  const order = [
    ...SOURCE_ORDER,
    ...["lp_form", "email"].filter((k) => curBySource.has(k) || prevBySource.has(k)),
  ];

  const receivers: ReceiverRow[] = order.map((k) => {
    const measured = covered.has(SOURCE_COVERAGE[k] ?? "");
    const c = curBySource.get(k);
    const p = prevBySource.get(k);
    return {
      key: k,
      label: SOURCE_LABEL[k] ?? k,
      inquiries: measured ? (c?.inquiries ?? 0) : null,
      prevInquiries: measured ? (p?.inquiries ?? 0) : null,
      // ★登録という概念があるのは公式LINEだけ
      registrations: k === "line" ? (measured ? (c?.registrations ?? 0) : null) : null,
      won: c?.won ?? 0,
      wonAmount: c?.amount ?? 0,
      measured,
    };
  });

  const inquiryRows = (cur as LeadSlim[]).filter((r) => r.type !== "line_friend");
  const prevInquiryRows = (prev as LeadSlim[]).filter((r) => r.type !== "line_friend");
  const lineMeasured = covered.has("lead_line");

  const countType = (rows: LeadSlim[], type: string) => rows.filter((r) => r.type === type).length;

  return {
    inquiries: {
      value: inquiryRows.length,
      prev: prevInquiryRows.length,
      // ★総数の目標は inquiries_total。旧 direct_inquiry/agency は種別の目標として下に出す
      target: targetOf("inquiries_total"),
    },
    registrations: {
      value: lineMeasured ? countType(cur as LeadSlim[], "line_friend") : null,
      prev: lineMeasured ? countType(prev as LeadSlim[], "line_friend") : null,
    },
    won: {
      count: inquiryRows.filter((r) => r.status === "won").length,
      amount: inquiryRows
        .filter((r) => r.status === "won")
        .reduce((s, r) => s + amountOf(r.closedAmount), 0),
      prevCount: prevInquiryRows.filter((r) => r.status === "won").length,
    },
    receivers,
    byType: [
      {
        key: "direct_inquiry",
        label: "直客",
        value: countType(cur as LeadSlim[], "direct_inquiry"),
        target: targetOf("direct_inquiry"),
      },
      {
        key: "agency",
        label: "代理店",
        value: countType(cur as LeadSlim[], "agency"),
        target: targetOf("agency"),
      },
    ],
    targetComparable: range.period !== null,
  };
}

// ── 段2: 経路の階段（記事 → 診断LP → 問い合わせ）──────────────────
//
// ★旧実装の誤り: GSC は「GSCの最終日から28日」、GA4 は「GA4の最終日から28日」を
//   合計して1本のファネルに並べていた。GSCは7/20まで、GA4のLPは7/11までしか
//   入っていないので、**別々の28日間**の数字が同じ階段に並んでいた。
//   期間は resolveRange() で1つに決め、全段に同じ since/until を渡す。
//
// ★データの到達遅延は「欠測」ではない。GSCは2〜3日遅れて入るのが正常なので、
//   各ソースの最終取得日を持って返し、画面に「〜7/20 の実測」と明示する。

/** 期間内の GSC/GA4 実測合計（MetricSnapshot = サイト全体） */
async function snapshotSum(
  where: { metric: string } | { metric: { startsWith: string } },
  range: Range,
): Promise<{ value: number; asOf: Date } | null> {
  const [agg, latest] = await Promise.all([
    prisma.metricSnapshot.aggregate({
      _sum: { value: true },
      _count: { _all: true },
      where: { ...where, date: range.dateWindow },
    }),
    prisma.metricSnapshot.findFirst({
      where,
      orderBy: { date: "desc" },
      select: { date: true },
    }),
  ]);
  // ★その指標の行が1つも無いのは 0 ではなく未計測（§3）
  if (!latest) return null;
  // 期間内に1行も無い場合も「0件」ではなく実測ゼロとして返す（計測自体は生きている）
  return { value: Math.round(agg._sum.value ?? 0), asOf: latest.date };
}

async function funnelStepCount(step: string, range: Range): Promise<number> {
  return prisma.funnelEvent.count({
    where: { step: step as never, occurredAt: { gte: range.since, lt: range.until } },
  });
}

export type FunnelView = StageFlow & {
  /** 各ソースの最終取得日。反映遅れを画面に出すために持つ */
  asOf: { gsc: Date | null; ga4: Date | null };
  /** 未計測のまま残っている段の数 */
  unmeasured: number;
};

export async function getFunnel(range: Range): Promise<FunnelView> {
  const measured = await measuredMetrics();
  const funnelMeasured = measured.has("funnel");

  const [impr, clicks, lpView, lpCtaClick, submit] = await Promise.all([
    snapshotSum({ metric: "impressions" }, range),
    snapshotSum({ metric: "clicks" }, range),
    // ★LPの変種（a/b/c）は合算。ABCの勝敗は /experiments の話で、
    //   ここが見たいのは「LPまで何人来て何人送信したか」
    snapshotSum({ metric: { startsWith: "lp_view_" } }, range),
    snapshotSum({ metric: { startsWith: "lp_cta_click_" } }, range),
    snapshotSum({ metric: { startsWith: "lp_form_submit_" } }, range),
  ]);

  // 記事側のCTA表示/クリックは自前タグ（FunnelEvent）。本番未設置
  const [ctaView, ctaClick] = funnelMeasured
    ? await Promise.all([funnelStepCount("cta_view", range), funnelStepCount("cta_click", range)])
    : [null, null];

  const stages: Stage[] = [
    {
      key: "impressions",
      label: "検索での表示",
      value: impr?.value ?? null,
      hint: "GSC 実測",
      action: "上位表示できるKWを増やす（/keywords）",
    },
    {
      key: "clicks",
      label: "記事へのクリック",
      value: clicks?.value ?? null,
      hint: "GSC 実測",
      action: "タイトル・説明文を書き換える（CTR改善）",
    },
    {
      key: "cta_view",
      label: "CTA表示",
      value: ctaView,
      hint: "記事内の計測タグ",
      action: "CTAの位置を上げる",
    },
    {
      key: "cta_click",
      label: "CTAクリック",
      value: ctaClick,
      hint: "記事内の計測タグ",
      action: "CTAの文言・形を変える",
    },
    {
      key: "lp_view",
      label: "診断LP到達",
      value: lpView?.value ?? null,
      hint: "GA4 lp_view",
      action: "記事→LPの導線を増やす",
    },
    {
      key: "lp_cta_click",
      label: "LP内CTAクリック",
      value: lpCtaClick?.value ?? null,
      hint: "GA4 lp_cta_click",
      action: "LPの構成・オファーを見直す",
    },
    {
      key: "submit",
      label: "問い合わせ送信",
      value: submit?.value ?? null,
      hint: "GA4 lp_form_submit",
      action: "フォームの項目を減らす",
    },
  ];

  return {
    ...buildFlow(stages),
    asOf: {
      gsc: impr?.asOf ?? clicks?.asOf ?? null,
      ga4: lpView?.asOf ?? submit?.asOf ?? null,
    },
    unmeasured: stages.filter((s) => s.value === null).length,
  };
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

// ── 指標の鮮度（測っているつもりで止まっているのを見つける）──────────
//
// ★なぜ要るか
//   2026-07-22 の点検で、全ジョブが success なのに pv が 7/13 から
//   9日間更新されていなかった。段7 は「ジョブが緑か」しか見ておらず、
//   「指標が増えているか」を見ていなかったため誰も気づけない。
//   ジョブの成功と、そのジョブが本来書くはずのデータが入っていることは別。
//
//   同じ理由で weekly_* 6指標（各572行）も 7/13 で止まり、
//   かつアプリのどこからも参照されていなかった。
//
// ★「古い」と「そもそも計測していない」を混同しない（§3）。
//   ここに出るのは1行でも入ったことがある指標だけ。
//   一度も無い指標は未計測であって、鮮度の問題ではない。

export type MetricFreshness = {
  metric: string;
  rows: number;
  lastDate: Date;
  /** 最終更新から今日までの日数（JST） */
  ageDays: number;
  /** 履歴から推定した更新間隔（日）。null は推定できるだけの点数が無い */
  intervalDays: number | null;
  alert: "ok" | "warn" | "red";
  /** 画面のどこかで使われているか。false なら貯めているだけ */
  used: boolean;
};

/**
 * 期待間隔は決め打ちしない。**その指標自身の履歴から求める**。
 *
 * ★最初は指標ごとに日数を手で書いていたが、それだと自分が知っている指標しか
 *   守れない。実際、決め打ち版は最重要の pv（9日停止）を見逃し、
 *   正常な threads_views（反映遅延で3日）を警告に出していた。
 *   日次で入る指標は中央値1日、週次なら7日と、履歴が間隔を教えてくれる。
 *
 * ★許容は「中央値の3倍」。日次なら3日、週次なら21日で警告になる。
 *   1回飛んだだけで鳴らせば、鳴っても誰も見なくなる。
 */
const STALE_MULTIPLIER = 3;
/** 履歴が短い指標で過敏にならないための下限（日） */
const STALE_MIN_DAYS = 3;
/** 間隔を推定するのに必要な最低データ点数。これ未満は判定しない（§16.5） */
const MIN_POINTS_FOR_INTERVAL = 4;

/** 日付列から更新間隔の中央値（日）を求める。求まらなければ null */
function medianIntervalDays(dates: Date[]): number | null {
  if (dates.length < MIN_POINTS_FOR_INTERVAL) return null;
  const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gaps.push((sorted[i].getTime() - sorted[i - 1].getTime()) / 86400000);
  }
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/** アプリが実際に読んでいる指標（読んでいないものは「貯めているだけ」と出す） */
const METRICS_IN_USE = new Set([
  "clicks",
  "impressions",
  "position",
  "pv",
  "pv_lifetime",
  "threads_views",
  "threads_likes",
  "threads_replies",
  "threads_reposts",
  "threads_quotes",
]);

export async function getMetricFreshness(now: Date = new Date()): Promise<MetricFreshness[]> {
  // ★直近60日の「その指標が書かれた日」を取って間隔を推定する
  const since = new Date(now.getTime() - 60 * 86400000);
  const [rows, recent] = await Promise.all([
    prisma.contentMetric.groupBy({
      by: ["metric"],
      _count: { _all: true },
      _max: { date: true },
    }),
    prisma.contentMetric.groupBy({
      by: ["metric", "date"],
      where: { date: { gte: since } },
    }),
  ]);

  const datesByMetric = new Map<string, Date[]>();
  for (const r of recent) {
    const arr = datesByMetric.get(r.metric) ?? [];
    arr.push(new Date(r.date));
    datesByMetric.set(r.metric, arr);
  }

  const today = new Date(now.getTime() + JST_OFFSET_MS);
  today.setUTCHours(0, 0, 0, 0);

  const out: MetricFreshness[] = [];
  for (const r of rows) {
    const last = r._max.date;
    if (!last) continue;
    const ageDays = Math.floor((today.getTime() - new Date(last).getTime()) / 86400000);
    const interval = medianIntervalDays(datesByMetric.get(r.metric) ?? []);

    // ★間隔が推定できないうちは判定しない。「まだ分からない」であって正常ではない
    let alert: "ok" | "warn" | "red" = "ok";
    if (interval !== null) {
      const limit = Math.max(interval * STALE_MULTIPLIER, STALE_MIN_DAYS);
      alert = ageDays > limit * 2 ? "red" : ageDays > limit ? "warn" : "ok";
    }

    out.push({
      metric: r.metric,
      rows: r._count._all,
      lastDate: new Date(last),
      ageDays,
      intervalDays: interval,
      alert,
      used: METRICS_IN_USE.has(r.metric),
    });
  }
  return out.sort((a, b) => b.ageDays - a.ageDays || a.metric.localeCompare(b.metric));
}

// ── 日次推移（元 media-console の「サイト全体 日次推移」「PV 日次推移」）──
//
// ★なぜ MMS に要るか
//   数字が段1〜段7 に「その時点の値」としてしか出ておらず、
//   増えているのか減っているのかが読めなかった。元のコンソールには
//   折れ線があり、そちらの方が状況を掴みやすいという指摘を受けた。
//
// ★null は 0 として繋がない。欠測日を 0 で描くと「落ち込んだ」に見える（§3）。

export type TrendPoint = { date: string; value: number | null };
export type SiteTrend = {
  clicks: TrendPoint[];
  impressions: TrendPoint[];
  position: TrendPoint[];
  pv: TrendPoint[];
  /** ★ゴールそのものの推移。問い合わせ件数（LINE登録を除く）/日 */
  inquiries: TrendPoint[];
  days: number;
  /**
   * 反映待ちの日数（末尾）。
   * ★GSCは2〜3日遅れて入る。その未到着分を「欠測」と書くと毎日警告が出て、
   *   本物の欠測が埋もれる。反映待ちと欠測は分けて扱う（§3）。
   */
  pendingDays: number;
  /** 期間内で本当に欠けている日数（反映待ちを除く） */
  missingDays: number;
};

/** 各ソースの最終取得日より後は「反映待ち」。それ以前の穴が本当の欠測 */
function countGaps(points: TrendPoint[], latestKey: string | null) {
  let pending = 0;
  let missing = 0;
  for (const p of points) {
    if (p.value !== null) continue;
    if (latestKey === null || p.date > latestKey) pending += 1;
    else missing += 1;
  }
  return { pending, missing };
}

export async function getSiteTrend(range: Range): Promise<SiteTrend> {
  const [snaps, pv, leads, gscLatest] = await Promise.all([
    prisma.metricSnapshot.findMany({
      where: {
        metric: { in: ["clicks", "impressions", "position"] },
        // ★@db.Date 列。JSTの0時を渡すと前日として扱われる（lib/period.ts）
        date: range.dateWindow,
      },
      select: { metric: true, value: true, date: true },
    }),
    prisma.contentMetric.groupBy({
      by: ["date"],
      where: { metric: "pv", date: range.dateWindow },
      _sum: { value: true },
    }),
    prisma.lead.findMany({
      where: { occurredAt: { gte: range.since, lt: range.until }, type: { not: "line_friend" } },
      select: { occurredAt: true },
    }),
    prisma.metricSnapshot.findFirst({
      where: { metric: "clicks" },
      orderBy: { date: "desc" },
      select: { date: true },
    }),
  ]);

  const maps: Record<string, Map<string, number>> = {
    clicks: new Map(),
    impressions: new Map(),
    position: new Map(),
    pv: new Map(),
  };
  for (const s of snaps) maps[s.metric]?.set(jstDayKey(s.date), s.value);
  for (const r of pv) maps.pv.set(jstDayKey(r.date), r._sum.value ?? 0);

  const keys = dayKeys(range.since, range.until);

  const series = (name: string): TrendPoint[] =>
    keys.map((k) => {
      const v = maps[name].get(k);
      return { date: k, value: v === undefined ? null : Math.round(v * 100) / 100 };
    });

  // ★リードは「その日に0件」が事実として意味を持つ（計測は動いている）。
  //   欠測ではないので 0 を入れる。GSC/PV の null とは扱いが違う。
  const leadByDay = new Map<string, number>();
  for (const l of leads) {
    const k = jstDayKey(l.occurredAt);
    leadByDay.set(k, (leadByDay.get(k) ?? 0) + 1);
  }

  const clicksSeries = series("clicks");
  const gaps = countGaps(clicksSeries, gscLatest ? jstDayKey(gscLatest.date) : null);

  return {
    clicks: clicksSeries,
    impressions: series("impressions"),
    position: series("position"),
    pv: series("pv"),
    inquiries: keys.map((k) => ({ date: k, value: leadByDay.get(k) ?? 0 })),
    days: keys.length,
    pendingDays: gaps.pending,
    missingDays: gaps.missing,
  };
}

// ── 送客の量（期間内・経路別）────────────────────────────────────
//
// ★受け皿（リード）だけ見ても、増減の原因が「送客が減った」のか
//   「受け皿が壊れた」のか分からない。送客側の量を同じ期間で並べる。

export type SenderVolume = {
  key: string;
  label: string;
  /** 送り出した量（表示・クリック・views など）。null = 未計測 */
  value: number | null;
  unit: string;
  /** 受け皿に着いた量。null = 未計測 */
  arrived: number | null;
  arrivedLabel: string;
  detailHref: string;
  note: string;
};

export async function getSenderVolumes(range: Range): Promise<SenderVolume[]> {
  // ★@db.Date 列（lib/period.ts）
  const win = range.dateWindow;
  // ★期間内に行が無いことと、そもそも計測していないことは別。
  //   計測開始が記録されていれば「その期間は 0 だった」が実測（§3）。
  const measured = await measuredMetrics();
  const anyThreadsClickMetric = await prisma.contentMetric.findFirst({
    where: { metric: { startsWith: "threads_link_clicks_" } },
    select: { id: true },
  });

  const [impressions, clicks, pv, threadsViews, threadsClicks] = await Promise.all([
    snapshotSum({ metric: "impressions" }, range),
    snapshotSum({ metric: "clicks" }, range),
    prisma.contentMetric.aggregate({
      _sum: { value: true },
      _count: { _all: true },
      where: { metric: "pv", date: win },
    }),
    prisma.contentMetric.aggregate({
      _sum: { value: true },
      _count: { _all: true },
      where: { metric: "threads_views", date: win },
    }),
    prisma.contentMetric.groupBy({
      by: ["metric"],
      _sum: { value: true },
      where: { metric: { startsWith: "threads_link_clicks_" }, date: win },
    }),
  ]);

  const threadsClickTotal = threadsClicks.reduce((s, r) => s + Math.round(r._sum.value ?? 0), 0);

  return [
    {
      key: "media",
      label: "メディア（検索流入）",
      value: impressions?.value ?? null,
      unit: "表示",
      arrived: clicks?.value ?? null,
      arrivedLabel: "記事クリック",
      detailHref: "/content",
      note: "GSC 実測",
    },
    {
      key: "article",
      label: "記事（閲覧）",
      value: measured.has("pv") || pv._count._all > 0 ? Math.round(pv._sum.value ?? 0) : null,
      unit: "PV",
      arrived: null,
      arrivedLabel: "記事→受け皿",
      detailHref: "/content",
      note: "GA4 実測。記事→受け皿のクリックは未計装（CTAタグが本番未設置）",
    },
    {
      key: "threads",
      label: "Threads",
      value:
        measured.has("threads_post_metrics") || threadsViews._count._all > 0
          ? Math.round(threadsViews._sum.value ?? 0)
          : null,
      unit: "views",
      // ★リダイレクタが1度でも記録していれば、期間内0件は実測ゼロ（未計測ではない）
      arrived: anyThreadsClickMetric ? threadsClickTotal : null,
      arrivedLabel: "リンククリック",
      detailHref: "/threads",
      note: "/r/ 経由のクリックのみ計測（LINE・LP・記事）",
    },
    {
      key: "hp",
      label: "HP",
      value: null,
      unit: "セッション",
      arrived: null,
      arrivedLabel: "フォーム到達",
      detailHref: "/leads",
      note: "HPのGA4を未接続。テーマ内の lin.ee も生リンクのため経路が取れない",
    },
  ];
}
