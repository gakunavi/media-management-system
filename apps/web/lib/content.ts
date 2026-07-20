// コンテンツ一覧・詳細の集計（設計書 §4.2 /content・§3.2.3）
//
// 既存データ（P1移行）: ContentMetric に日次 clicks/impressions/position/pv、
//   週次 weekly_*、pv_lifetime。GSC は 2026-07-10 で止まっている（段7で欠測表示）。
import { prisma } from "@mms/db";

const DAY = 86400000;

/**
 * 移行元タイトルに残る HTML エンティティを復号する（&#038; → & など）。
 * WordPress 由来の実体参照が media.db に文字列として入っているため。
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export type ContentRow = {
  id: string;
  externalId: string;
  title: string;
  type: string;
  status: string;
  publishedAt: Date | null;
  clicks28: number | null; // 直近28日クリック合計
  impressions28: number | null;
  avgPosition7: number | null; // 直近7日平均順位
  positionDelta: number | null; // 前週比（+ が改善＝順位が小さくなった）
  pvLifetime: number | null;
};

/** 記事一覧。最新の実測がある日を基準に集計する（GSCが止まっていても直近を出す） */
export async function getContentList(): Promise<ContentRow[]> {
  const items = await prisma.contentItem.findMany({
    where: { type: { in: ["article", "article_unlinked"] } },
    select: {
      id: true,
      externalId: true,
      title: true,
      type: true,
      status: true,
      publishedAt: true,
    },
  });
  if (items.length === 0) return [];

  // 実測の最新日（clicks 基準）
  const latest = await prisma.contentMetric.findFirst({
    where: { metric: "clicks" },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const latestDate = latest?.date ?? new Date();
  const since28 = new Date(latestDate.getTime() - 27 * DAY);
  const since7 = new Date(latestDate.getTime() - 6 * DAY);
  const prev7Start = new Date(latestDate.getTime() - 13 * DAY);
  const prev7End = new Date(latestDate.getTime() - 7 * DAY);

  // clicks/impressions の28日合計
  const sum28 = await prisma.contentMetric.groupBy({
    by: ["contentItemId", "metric"],
    where: { metric: { in: ["clicks", "impressions"] }, date: { gte: since28, lte: latestDate } },
    _sum: { value: true },
  });
  // position の直近7日平均・前週7日平均
  const [pos7, posPrev7] = await Promise.all([
    prisma.contentMetric.groupBy({
      by: ["contentItemId"],
      where: { metric: "position", date: { gte: since7, lte: latestDate } },
      _avg: { value: true },
    }),
    prisma.contentMetric.groupBy({
      by: ["contentItemId"],
      where: { metric: "position", date: { gte: prev7Start, lte: prev7End } },
      _avg: { value: true },
    }),
  ]);
  // pv_lifetime（1記事1行）
  const pvl = await prisma.contentMetric.findMany({
    where: { metric: "pv_lifetime" },
    select: { contentItemId: true, value: true },
  });

  const clicksBy = new Map<string, number>();
  const imprBy = new Map<string, number>();
  for (const r of sum28) {
    const v = r._sum.value ?? 0;
    if (r.metric === "clicks") clicksBy.set(r.contentItemId, v);
    else imprBy.set(r.contentItemId, v);
  }
  const pos7By = new Map(pos7.map((r) => [r.contentItemId, r._avg.value]));
  const posPrevBy = new Map(posPrev7.map((r) => [r.contentItemId, r._avg.value]));
  const pvlBy = new Map(pvl.map((r) => [r.contentItemId, r.value]));

  const rows: ContentRow[] = items.map((it) => {
    const cur = pos7By.get(it.id) ?? null;
    const prev = posPrevBy.get(it.id) ?? null;
    // 順位は小さいほど良い。改善(+)＝prev - cur が正
    const delta = cur !== null && prev !== null ? Math.round((prev - cur) * 10) / 10 : null;
    return {
      id: it.id,
      externalId: it.externalId,
      title: decodeEntities(it.title),
      type: it.type,
      status: it.status,
      publishedAt: it.publishedAt,
      clicks28: clicksBy.has(it.id) ? Math.round(clicksBy.get(it.id)!) : null,
      impressions28: imprBy.has(it.id) ? Math.round(imprBy.get(it.id)!) : null,
      avgPosition7: cur !== null ? Math.round(cur * 10) / 10 : null,
      positionDelta: delta,
      pvLifetime: pvlBy.has(it.id) ? Math.round(pvlBy.get(it.id)!) : null,
    };
  });

  // 直近クリックが多い順（実測がある記事を上に）
  rows.sort((a, b) => (b.clicks28 ?? -1) - (a.clicks28 ?? -1));
  return rows;
}

export type ContentDetail = {
  id: string;
  externalId: string;
  title: string;
  url: string | null;
  type: string;
  status: string;
  publishedAt: Date | null;
  category: string | null;
  isPillar: boolean;
  aioTier: string;
  note: string | null;
  /** 日次の系列（clicks / impressions / position / pv） */
  series: { date: string; clicks: number | null; impressions: number | null; position: number | null; pv: number | null }[];
};

export async function getContentDetail(externalId: string): Promise<ContentDetail | null> {
  const it = await prisma.contentItem.findFirst({
    where: { externalId },
    select: {
      id: true,
      externalId: true,
      title: true,
      url: true,
      type: true,
      status: true,
      publishedAt: true,
      category: true,
      isPillar: true,
      aioTier: true,
      note: true,
    },
  });
  if (!it) return null;

  const metrics = await prisma.contentMetric.findMany({
    where: {
      contentItemId: it.id,
      metric: { in: ["clicks", "impressions", "position", "pv"] },
    },
    orderBy: { date: "asc" },
    select: { metric: true, value: true, date: true },
  });

  // 日付ごとにまとめる
  const byDate = new Map<
    string,
    { clicks: number | null; impressions: number | null; position: number | null; pv: number | null }
  >();
  for (const m of metrics) {
    const key = m.date.toISOString().slice(0, 10);
    const row = byDate.get(key) ?? { clicks: null, impressions: null, position: null, pv: null };
    (row as Record<string, number | null>)[m.metric] = Math.round(m.value * 10) / 10;
    byDate.set(key, row);
  }
  const series = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, v]) => ({ date, ...v }));

  return { ...it, title: decodeEntities(it.title), series };
}

export const CONTENT_STATUS_LABEL: Record<string, string> = {
  publish: "公開",
  draft: "下書き",
  unknown: "不明",
};
