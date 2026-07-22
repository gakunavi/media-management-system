// Threads 実績の集計（設計書 §4.2 /threads・§13.4-④）
//
// ★データは GAS のスプレッドシートから builtin/threads_sync.py が pull している。
//   MMS は Threads API を叩かない（トークンは GAS 側に置いたまま）。
//
// ★ここでの中心的な注意: **未計測と 0 を混ぜない**（§3）。
//   Insights が回収できていない投稿を views=0 として平均に入れると、
//   平均が下がり「跳ねていない投稿が跳ねて見える」「効いているフォーマットが
//   効いていないように見える」の両方が起きる。未計測は件数として別に出す。
import { prisma } from "@mms/db";

const METRICS = ["views", "likes", "replies", "reposts", "quotes"] as const;
type MetricKey = (typeof METRICS)[number];

/**
 * 代理店募集トラック（AGC-001）の目印。
 *
 * ★これを集客コンテンツと同じ土俵で比較してはいけない。代理店募集は対象が
 *   狭くviewsは伸びないのが当然で、評価軸はDM獲得であってviewsではない。
 *   混ぜると「A12は低調だから減らせ」という有害な提案が出る（実際に出た）。
 */
const AGENCY_TARGET = "代理店候補";

/**
 * 送客クリックの指標名。
 * ★`threads_link_clicks_lp__setsuzei-diagnosis-a` のような変種別も
 *   同じ接頭辞を持つ。合計に足すと二重計上になるので、明示列挙する。
 */
const LINK_CLICK_METRICS = [
  "threads_link_clicks_soken",
  "threads_link_clicks_lp",
  "threads_link_clicks_line",
];

export type ThreadsPost = {
  id: string;
  externalId: string;
  title: string;
  format: string;
  target: string | null;
  coreMessage: string | null;
  publishedAt: Date | null;
  /** null = 未計測（Insights 未回収）。0 とは意味が違う */
  views: number | null;
  engagement: number | null;
  /** 送客クリック（リンクを貼っていない投稿は 0） */
  clicks: number;
  /** 投稿に貼った送客リンク。null なら導線なし */
  linkUrl: string | null;
  /** 内訳。null は未計測（§3）。quotes は実測0が続いているので合計にのみ含める */
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  /** 代理店募集トラック。集客コンテンツとは評価軸が違う */
  isAgency: boolean;
};

export type GroupStat = {
  name: string;
  posts: number;
  /** 計測できている投稿数。posts との差が未計測 */
  measured: number;
  avgViews: number | null;
  avgEngagement: number | null;
  totalViews: number;

  // ── 反応の内訳 ────────────────────────────────
  //  ★views だけで並べると順位が実態とずれる。2026-07-22 の実測で
  //    質問型は views 1位・いいね率11位・返信数2位だった。
  //    「反応が良い」の定義によって勝つフォーマットが変わる。
  totalLikes: number;
  totalReplies: number;
  totalReposts: number;
  /** いいね ÷ views（％）。反応が少なすぎるときは null（§16.5） */
  likeRate: number | null;
  /** 1投稿あたりの返信数。会話が始まった度合い＝DM に最も近い指標 */
  repliesPerPost: number | null;

  /**
   * 送客クリック数（節税総研 / 診断LP / 公式LINE の合計）。
   * ★4つの目的のうち2つ（LP送客・LINE送客）に直接対応する唯一の実測値。
   *   リンクを貼った投稿がまだ無い間は 0 が並ぶが、これは「導線が無い」であって
   *   「効かなかった」ではない。linkedPosts と併せて読むこと。
   */
  clicks: number;
  /** そのグループでリンクを貼った投稿数。0 なら clicks=0 は当然 */
  linkedPosts: number;
};

export type ThreadsSummary = {
  posts: number;
  measured: number;
  unmeasured: number;
  /** 代理店募集トラックの投稿数（フォーマット比較からは除外している） */
  agencyPosts: number;
  totalViews: number;
  avgViews: number | null;
  /** 全フォーマットの平均viewsの中央値。個別フォーマットの良し悪しの基準 */
  medianFormatAvg: number | null;
  firstPostedAt: Date | null;
  lastPostedAt: Date | null;
};

export type ThreadsData = {
  summary: ThreadsSummary;
  /** 集客コンテンツのフォーマット別（★代理店トラックは含まない） */
  byFormat: GroupStat[];
  byTarget: GroupStat[];
  byCore: GroupStat[];
  /** 代理店募集トラックの angle 別。viewsでの優劣判断はしない */
  byAgencyAngle: GroupStat[];
  top: ThreadsPost[];
};

/** 集計に足る母数。これ未満のグループは平均を出さない（§16.5 の考え方） */
export const MIN_POSTS_FOR_STAT = 10;

/**
 * いいね率を出すのに必要な、そのグループの合計いいね数（§16.5）。
 *
 * ★2026-07-22 の実測: 579投稿で いいね計 約400・返信計 約110。
 *   いいねが付いた投稿は 166/579、返信が付いた投稿は 44/579 しかない。
 *   この粗さで率を出すと、いいね3件（A12）の 0.39% が
 *   いいね120件（あるある型）の 0.31% より上に並ぶ。
 *   件数が足りないものは「不明」であって「優秀」ではない。
 */
export const MIN_ENGAGEMENTS_FOR_RATE = 10;

export async function getThreadsData(): Promise<ThreadsData> {
  const items = await prisma.contentItem.findMany({
    where: { type: "post", channel: { type: "threads" } },
    select: {
      id: true,
      externalId: true,
      title: true,
      note: true,
      targetLabel: true,
      category: true,
      publishedAt: true,
      url: true,
    },
  });

  const metrics = await prisma.contentMetric.groupBy({
    by: ["contentItemId", "metric"],
    where: { metric: { in: METRICS.map((m) => `threads_${m}`) } },
    _max: { value: true },
  });

  // ★送客クリックは views と違って日次で積み上がる（最大値ではなく合計）。
  //   変種別（__setsuzei-diagnosis-a 等）は内訳なので二重に数えない
  const clickRows = await prisma.contentMetric.groupBy({
    by: ["contentItemId"],
    where: {
      metric: { in: LINK_CLICK_METRICS },
    },
    _sum: { value: true },
  });
  const clicksByItem = new Map(clickRows.map((r) => [r.contentItemId, r._sum.value ?? 0]));

  const byItem = new Map<string, Partial<Record<MetricKey, number>>>();
  for (const m of metrics) {
    const key = m.metric.replace(/^threads_/, "") as MetricKey;
    const cur = byItem.get(m.contentItemId) ?? {};
    cur[key] = m._max.value ?? 0;
    byItem.set(m.contentItemId, cur);
  }

  const posts: ThreadsPost[] = items.map((it) => {
    const m = byItem.get(it.id);
    // ★ContentMetric の行が無い＝未計測。views:null で表現し、0 と区別する
    const views = m?.views ?? null;
    const engagement =
      m === undefined
        ? null
        : (m.likes ?? 0) + (m.replies ?? 0) + (m.reposts ?? 0) + (m.quotes ?? 0);
    return {
      id: it.id,
      externalId: it.externalId,
      title: it.title,
      format: it.note?.trim() || "unknown",
      target: it.targetLabel,
      coreMessage: it.category,
      publishedAt: it.publishedAt,
      views,
      engagement,
      clicks: clicksByItem.get(it.id) ?? 0,
      linkUrl: it.url,
      likes: m?.likes ?? null,
      replies: m?.replies ?? null,
      reposts: m?.reposts ?? null,
      isAgency: (it.targetLabel ?? "").trim() === AGENCY_TARGET,
    };
  });

  // ★フォーマット比較は集客コンテンツだけで行う
  const contentPosts = posts.filter((p) => !p.isAgency);
  const agencyPosts = posts.filter((p) => p.isAgency);

  const measuredPosts = posts.filter((p) => p.views !== null);
  const totalViews = measuredPosts.reduce((s, p) => s + (p.views ?? 0), 0);
  const dates = posts
    .map((p) => p.publishedAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  const byFormat = groupBy(contentPosts, (p) => p.format);
  const formatAvgs = byFormat
    .filter((g) => g.measured >= MIN_POSTS_FOR_STAT && g.avgViews !== null)
    .map((g) => g.avgViews as number)
    .sort((a, b) => a - b);

  return {
    summary: {
      posts: posts.length,
      measured: measuredPosts.length,
      unmeasured: posts.length - measuredPosts.length,
      agencyPosts: agencyPosts.length,
      totalViews,
      avgViews: measuredPosts.length ? Math.round(totalViews / measuredPosts.length) : null,
      medianFormatAvg: formatAvgs.length
        ? Math.round(formatAvgs[Math.floor(formatAvgs.length / 2)])
        : null,
      firstPostedAt: dates[0] ?? null,
      lastPostedAt: dates[dates.length - 1] ?? null,
    },
    byFormat,
    byTarget: groupBy(posts, (p) => p.target?.trim() || "未設定"),
    byCore: groupBy(posts, (p) => p.coreMessage?.trim() || "未設定"),
    byAgencyAngle: groupBy(agencyPosts, (p) => p.format),
    top: [...measuredPosts].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 15),
  };
}

function groupBy(posts: ThreadsPost[], key: (p: ThreadsPost) => string): GroupStat[] {
  const map = new Map<string, ThreadsPost[]>();
  for (const p of posts) {
    const k = key(p);
    const arr = map.get(k);
    if (arr) arr.push(p);
    else map.set(k, [p]);
  }

  const out: GroupStat[] = [];
  for (const [name, arr] of map) {
    const measured = arr.filter((p) => p.views !== null);
    const totalViews = measured.reduce((s, p) => s + (p.views ?? 0), 0);
    const totalEng = measured.reduce((s, p) => s + (p.engagement ?? 0), 0);
    const totalLikes = measured.reduce((s, p) => s + (p.likes ?? 0), 0);
    const totalReplies = measured.reduce((s, p) => s + (p.replies ?? 0), 0);
    const totalReposts = measured.reduce((s, p) => s + (p.reposts ?? 0), 0);
    // ★送客は未計測の概念が無い（クリックされなければ0）。measured で絞らない
    const clicks = arr.reduce((s, p) => s + p.clicks, 0);
    const linkedPosts = arr.filter((p) => p.linkUrl).length;
    out.push({
      name,
      posts: arr.length,
      measured: measured.length,
      // ★母数が小さいグループは平均を出さない。1〜2件の平均で判断させない
      avgViews:
        measured.length >= MIN_POSTS_FOR_STAT ? Math.round(totalViews / measured.length) : null,
      avgEngagement:
        measured.length >= MIN_POSTS_FOR_STAT
          ? Math.round((totalEng / measured.length) * 10) / 10
          : null,
      totalViews,
      totalLikes,
      totalReplies,
      totalReposts,
      // ★反応そのものが少ないうちは率を出さない。いいね3件の 0.39% と
      //   いいね120件の 0.31% を並べると、前者が上に来て判断を誤る（§16.5）
      likeRate:
        totalLikes >= MIN_ENGAGEMENTS_FOR_RATE && totalViews > 0
          ? Math.round((totalLikes / totalViews) * 10000) / 100
          : null,
      repliesPerPost:
        measured.length >= MIN_POSTS_FOR_STAT
          ? Math.round((totalReplies / measured.length) * 100) / 100
          : null,
      clicks,
      linkedPosts,
    });
  }
  // 平均が出せるものを上に、その中で平均views降順
  out.sort((a, b) => {
    if (a.avgViews === null && b.avgViews === null) return b.posts - a.posts;
    if (a.avgViews === null) return 1;
    if (b.avgViews === null) return -1;
    return b.avgViews - a.avgViews;
  });
  return out;
}


// ── アカウントの健全性（§2454 SnsAccountHealth・配信制限の検知）──

export type HealthRow = {
  date: Date;
  followers: number;
  followersDelta: number;
  postsDelivered: number;
  avgViews: number | null;
  viewsPerFollower: number | null;
  restrictionSuspected: boolean;
};

export type AccountHealth = {
  rows: HealthRow[];
  latest: HealthRow | null;
  /** 基準線を引けるだけの履歴があるか。無いうちは「異常なし」と言ってはいけない */
  hasBaseline: boolean;
  /** 判定に必要な日数（UIで残り日数を出すため） */
  minDays: number;
  suspectedDays: number;
};

/** 基準線に要る日数。route.ts の RESTRICTION_MIN_HISTORY_DAYS と揃える */
export const HEALTH_MIN_DAYS = 7;

export async function getAccountHealth(): Promise<AccountHealth> {
  const rows = await prisma.snsAccountHealth.findMany({
    where: { channel: { type: "threads" } },
    orderBy: { date: "desc" },
    take: 60,
    select: {
      date: true,
      followers: true,
      followersDelta: true,
      postsDelivered: true,
      avgViews: true,
      viewsPerFollower: true,
      restrictionSuspected: true,
    },
  });

  const measured = rows.filter((r) => r.viewsPerFollower !== null).length;
  return {
    rows,
    latest: rows[0] ?? null,
    hasBaseline: measured >= HEALTH_MIN_DAYS,
    minDays: HEALTH_MIN_DAYS,
    suspectedDays: rows.filter((r) => r.restrictionSuspected).length,
  };
}
