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
    },
  });

  const metrics = await prisma.contentMetric.groupBy({
    by: ["contentItemId", "metric"],
    where: { metric: { in: METRICS.map((m) => `threads_${m}`) } },
    _max: { value: true },
  });

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
