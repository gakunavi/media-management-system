// コンテンツ一覧・詳細の集計（設計書 §4.2 /content・§3.2.3）
//
// ★この画面のゴール（2026-07-23 に整理）
//   記事はメディア送客の起点で、目的は問い合わせを増やすこと。
//   PV・クリック・順位は**その手前の数字**であって成果ではない。
//   だから「その記事から問い合わせに繋がったか」を同じ表に並べる。
//
// ★期間は resolveRange() で1か所に決める。旧実装は「clicks の最終日から28日」を
//   固定しており、ダッシュボードで「今月」を見た数字と一致しなかった
//   （2026-07-22 に他画面で直した「別々の28日間」問題がここに残っていた）。
//
// ★埋まっていない軸を画面に出す。買い手軸・鮮度・クラスタは
//   ContentItem が持てるのに 159件中0件で、**列が無いため空であることすら
//   見えなかった**。段3「買い手の質」が未計測なのはこれが原因。
import { prisma } from "@mms/db";
import { jstDayKey, type Range } from "./period";

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

export const CONTENT_STATUS_LABEL: Record<string, string> = {
  publish: "公開",
  draft: "下書き",
  unknown: "不明",
};

export const AUDIENCE_LABEL: Record<string, string> = {
  corporate: "法人向け",
  sole_proprietor: "個人事業主向け",
  both: "両方",
  partner: "パートナー向け",
};

export const FORMAT_LABEL: Record<string, string> = {
  product: "商材",
  comparison: "比較",
  system: "制度",
  news: "時事",
  howto: "実務",
  risk: "リスク",
  case_study: "事例",
};

/**
 * ★buyer/audience の使い分け（2026-07-23 訂正）
 *   budgetTier（高/中/低）は**商談相手の予算**で、記事から読者の予算規模は決まらない。
 *   同じ外貨両替機（350万/台）の記事を1台買う人も数千万分買う人も読む。
 *   記事について確実に言えるのは「誰に向けて・何を書いたか」だけ。
 */
export const BUDGET_LABEL: Record<string, string> = {
  high: "高",
  mid: "中",
  low: "低",
  unknown: "—",
};

export const FUNNEL_LABEL: Record<string, string> = {
  awareness: "認知",
  comparison: "比較",
  product_deep: "商材理解",
  decision: "決定",
};

export type ContentRow = {
  id: string;
  externalId: string;
  title: string;
  type: string;
  status: string;
  publishedAt: Date | null;
  /** 期間内のクリック合計。null = その期間に実測が1行も無い */
  clicks: number | null;
  impressions: number | null;
  /** 期間内の平均順位 */
  avgPosition: number | null;
  /** 前期間との差。+ が改善（順位が小さくなった）。null = どちらかが未計測 */
  positionDelta: number | null;
  /** 期間内のPV */
  pv: number | null;
  pvLifetime: number | null;
  /** ★ゴール。この記事が初回接点だったリード（期間内） */
  leads: number;
  won: number;
  // ── 埋まっていない軸（空であることを画面に出す）──
  audience: string[];
  contentFormat: string | null;
  budgetTier: string;
  funnelStage: string | null;
  freshnessTier: string | null;
  mainKeywordId: string | null;
  aioTier: string;
  isPillar: boolean;
  clusterCount: number;
};

/** 未タグと判定する条件。ここが埋まらないと「どのタグが効くか」を出せない */
export function isUntagged(r: ContentRow): boolean {
  return r.audience.length === 0 || r.contentFormat === null;
}

export type TagCoverage = {
  total: number;
  audience: number;
  format: number;
  budget: number;
  funnel: number;
  freshness: number;
  mainKeyword: number;
  cluster: number;
  aio: number;
};

export type ContentList = {
  rows: ContentRow[];
  coverage: TagCoverage;
  /** 各指標の最終取得日。★画面に直書きしない（実データから出す） */
  asOf: { clicks: Date | null; pv: Date | null; pvLifetime: Date | null };
  /**
   * 記事からの送客クリック。
   * ★記事別には分解できない。リダイレクタの送り元は設置場所ID
   *   （media-article-bottom 等）で、どの記事から踏まれたかを持たない。
   *   記事別に出すには /r/line/{設置場所}-{記事ID} のように記事IDを
   *   URLへ入れる必要がある。いまは合計だけを正直に出す。
   */
  outbound: { placement: string; dest: string; clicks: number }[];
  outboundMeasured: boolean;
};

const ROUND1 = (n: number) => Math.round(n * 10) / 10;

export async function getContentList(range: Range): Promise<ContentList> {
  const items = await prisma.contentItem.findMany({
    where: { type: { in: ["article", "article_unlinked"] } },
    select: {
      id: true,
      externalId: true,
      title: true,
      type: true,
      status: true,
      publishedAt: true,
      audience: true,
      contentFormat: true,
      budgetTier: true,
      funnelStage: true,
      freshnessTier: true,
      mainKeywordId: true,
      aioTier: true,
      isPillar: true,
      _count: { select: { clusters: true } },
    },
  });
  if (items.length === 0) {
    return {
      rows: [],
      coverage: { total: 0, audience: 0, format: 0, budget: 0, funnel: 0, freshness: 0, mainKeyword: 0, cluster: 0, aio: 0 },
      asOf: { clicks: null, pv: null, pvLifetime: null },
      outbound: [],
      outboundMeasured: false,
    };
  }

  const [cur, prev, pvl, leads, latestClicks, latestPv, latestPvl, outboundRows, coverage] =
    await Promise.all([
      // ★@db.Date 列。dateWindow を使う（lib/period.ts §4-15）
      prisma.contentMetric.groupBy({
        by: ["contentItemId", "metric"],
        where: {
          metric: { in: ["clicks", "impressions", "position", "pv"] },
          date: range.dateWindow,
        },
        _sum: { value: true },
        _avg: { value: true },
      }),
      prisma.contentMetric.groupBy({
        by: ["contentItemId"],
        where: { metric: "position", date: range.prevDateWindow },
        _avg: { value: true },
      }),
      prisma.contentMetric.findMany({
        where: { metric: "pv_lifetime" },
        select: { contentItemId: true, value: true },
      }),
      // ★ゴール。この記事が初回接点だったリード
      prisma.lead.groupBy({
        by: ["firstTouchContentId", "status"],
        where: {
          firstTouchContentId: { not: null },
          occurredAt: { gte: range.since, lt: range.until },
        },
        _count: { _all: true },
      }),
      prisma.contentMetric.findFirst({
        where: { metric: "clicks" },
        orderBy: { date: "desc" },
        select: { date: true },
      }),
      prisma.contentMetric.findFirst({
        where: { metric: "pv" },
        orderBy: { date: "desc" },
        select: { date: true },
      }),
      prisma.contentMetric.findFirst({
        where: { metric: "pv_lifetime" },
        orderBy: { date: "desc" },
        select: { date: true },
      }),
      // 記事末CTA等の送客（設置場所別・記事別には分解できない）
      prisma.metricSnapshot.groupBy({
        by: ["metric"],
        where: { metric: { contains: "_link_clicks_" }, date: range.dateWindow },
        _sum: { value: true },
      }),
      prisma.measurementCoverage.findMany({ select: { metric: true } }),
    ]);

  const sumBy = new Map<string, number>();
  const avgBy = new Map<string, number>();
  for (const r of cur) {
    sumBy.set(`${r.contentItemId}:${r.metric}`, r._sum.value ?? 0);
    if (r._avg.value !== null) avgBy.set(`${r.contentItemId}:${r.metric}`, r._avg.value);
  }
  const prevPos = new Map(prev.map((r) => [r.contentItemId, r._avg.value]));
  const pvlBy = new Map(pvl.map((r) => [r.contentItemId, r.value]));

  const leadBy = new Map<string, { leads: number; won: number }>();
  for (const l of leads) {
    if (!l.firstTouchContentId) continue;
    const a = leadBy.get(l.firstTouchContentId) ?? { leads: 0, won: 0 };
    a.leads += l._count._all;
    if (l.status === "won") a.won += l._count._all;
    leadBy.set(l.firstTouchContentId, a);
  }

  const rows: ContentRow[] = items.map((it) => {
    const get = (m: string) => (sumBy.has(`${it.id}:${m}`) ? sumBy.get(`${it.id}:${m}`)! : null);
    const posCur = avgBy.get(`${it.id}:position`) ?? null;
    const posPrev = prevPos.get(it.id) ?? null;
    const lead = leadBy.get(it.id);
    return {
      id: it.id,
      externalId: it.externalId,
      title: decodeEntities(it.title),
      type: it.type,
      status: it.status,
      publishedAt: it.publishedAt,
      clicks: get("clicks") === null ? null : Math.round(get("clicks")!),
      impressions: get("impressions") === null ? null : Math.round(get("impressions")!),
      avgPosition: posCur === null ? null : ROUND1(posCur),
      // 順位は小さいほど良い。改善(+)＝prev - cur が正
      positionDelta: posCur !== null && posPrev !== null ? ROUND1(posPrev - posCur) : null,
      pv: get("pv") === null ? null : Math.round(get("pv")!),
      pvLifetime: pvlBy.has(it.id) ? Math.round(pvlBy.get(it.id)!) : null,
      leads: lead?.leads ?? 0,
      won: lead?.won ?? 0,
      audience: it.audience,
      contentFormat: it.contentFormat,
      budgetTier: it.budgetTier,
      funnelStage: it.funnelStage,
      freshnessTier: it.freshnessTier,
      mainKeywordId: it.mainKeywordId,
      aioTier: it.aioTier,
      isPillar: it.isPillar,
      clusterCount: it._count.clusters,
    };
  });

  const covered = new Set(coverage.map((c) => c.metric));
  const outbound = outboundRows
    .map((r) => {
      // {threads|site}_link_clicks_{dest}__{placement}
      const m = /_link_clicks_([a-z]+)__(.+)$/.exec(r.metric);
      if (!m) return null;
      return { placement: m[2], dest: m[1], clicks: Math.round(r._sum.value ?? 0) };
    })
    .filter((x): x is { placement: string; dest: string; clicks: number } => x !== null)
    // ★記事に置いた導線だけ（Threads投稿やHPのCTAは別画面の話）
    .filter((x) => x.placement.startsWith("media-article") || x.placement.startsWith("article"))
    .sort((a, b) => b.clicks - a.clicks);

  return {
    rows,
    coverage: {
      total: rows.length,
      audience: rows.filter((r) => r.audience.length > 0).length,
      format: rows.filter((r) => r.contentFormat !== null).length,
      budget: rows.filter((r) => r.budgetTier !== "unknown").length,
      funnel: rows.filter((r) => r.funnelStage !== null).length,
      freshness: rows.filter((r) => r.freshnessTier !== null).length,
      mainKeyword: rows.filter((r) => r.mainKeywordId !== null).length,
      cluster: rows.filter((r) => r.clusterCount > 0).length,
      aio: rows.filter((r) => r.aioTier !== "none").length,
    },
    asOf: {
      clicks: latestClicks?.date ?? null,
      pv: latestPv?.date ?? null,
      pvLifetime: latestPvl?.date ?? null,
    },
    outbound,
    // ★1度も計測が始まっていないなら 0 ではなく未計装（§3）
    outboundMeasured: [...covered].some((m) => m.includes("_link_clicks_")),
  };
}

// ── タグ別の実績（どのタグが結果を生むか）──────────────────
//
// ★これが分類の目的。「法人向け記事はPVが伸びているか」
//   「どの型が送客・問い合わせに効くか」を出すためにタグを付けた。
//
// ★1記事あたりで見る。記事数が違うタグを実数で比べると、
//   単に本数が多いタグが勝つ（リスク46本 vs 事例7本）。

export type TagStat = {
  key: string;
  label: string;
  articles: number;
  clicks: number;
  impressions: number;
  pv: number;
  leads: number;
  /** 1記事あたりクリック。本数の違うタグを比べるのに要る */
  clicksPerArticle: number;
  /** クリック率（clicks / impressions）。検索結果で選ばれているか */
  ctr: number | null;
  avgPosition: number | null;
};

function aggregate(rows: ContentRow[], label: string, key: string): TagStat {
  const measured = rows.filter((r) => r.clicks !== null);
  const clicks = rows.reduce((s, r) => s + (r.clicks ?? 0), 0);
  const impressions = rows.reduce((s, r) => s + (r.impressions ?? 0), 0);
  const positions = rows.map((r) => r.avgPosition).filter((v): v is number => v !== null);
  return {
    key,
    label,
    articles: rows.length,
    clicks,
    impressions,
    pv: rows.reduce((s, r) => s + (r.pv ?? 0), 0),
    leads: rows.reduce((s, r) => s + r.leads, 0),
    clicksPerArticle: measured.length > 0 ? Math.round((clicks / measured.length) * 10) / 10 : 0,
    // ★母数0で率を出さない（§16.5）
    ctr: impressions > 0 ? clicks / impressions : null,
    avgPosition:
      positions.length > 0
        ? Math.round((positions.reduce((a, b) => a + b, 0) / positions.length) * 10) / 10
        : null,
  };
}

export function tagStats(rows: ContentRow[]): { audience: TagStat[]; format: TagStat[] } {
  const audKeys = ["corporate", "sole_proprietor", "both", "partner"];
  const fmtKeys = ["comparison", "product", "risk", "howto", "system", "news", "case_study"];

  const audience = audKeys
    .map((k) => aggregate(rows.filter((r) => r.audience.includes(k)), AUDIENCE_LABEL[k] ?? k, k))
    .filter((s) => s.articles > 0);
  const untaggedAud = rows.filter((r) => r.audience.length === 0);
  if (untaggedAud.length > 0) audience.push(aggregate(untaggedAud, "未分類", "none"));

  const format = fmtKeys
    .map((k) => aggregate(rows.filter((r) => r.contentFormat === k), FORMAT_LABEL[k] ?? k, k))
    .filter((s) => s.articles > 0);
  const untaggedFmt = rows.filter((r) => r.contentFormat === null);
  if (untaggedFmt.length > 0) format.push(aggregate(untaggedFmt, "未分類", "none"));

  // 1記事あたりクリックの多い順（本数の多さで勝たないように）
  audience.sort((a, b) => b.clicksPerArticle - a.clicksPerArticle);
  format.sort((a, b) => b.clicksPerArticle - a.clicksPerArticle);
  return { audience, format };
}

// ── 絞り込みと並べ替え ────────────────────────────────────
//
// ★179件を固定順で全部出しても「どれを直すか」は決まらない。
//   探したいのは「落ちた記事」「実測が無い記事」「タグが無い記事」。

export const CONTENT_FILTERS = [
  { key: "all", label: "すべて" },
  { key: "measured", label: "実測あり" },
  { key: "nodata", label: "実測なし" },
  { key: "dropped", label: "順位が落ちた" },
  { key: "untagged", label: "未タグ" },
  { key: "corporate", label: "法人向け" },
  { key: "sole_proprietor", label: "個人事業主向け" },
  { key: "comparison", label: "比較記事" },
  { key: "pillar", label: "ピラー" },
] as const;

export type ContentFilter = (typeof CONTENT_FILTERS)[number]["key"];

export const CONTENT_SORTS = [
  { key: "clicks", label: "クリック" },
  { key: "leads", label: "問い合わせ" },
  { key: "position", label: "順位" },
  { key: "delta", label: "前期間差" },
  { key: "pv", label: "PV" },
  { key: "published", label: "公開日" },
] as const;

export type ContentSort = (typeof CONTENT_SORTS)[number]["key"];

export function resolveFilter(v: string | string[] | undefined): ContentFilter {
  const k = Array.isArray(v) ? v[0] : v;
  return CONTENT_FILTERS.some((f) => f.key === k) ? (k as ContentFilter) : "all";
}
export function resolveSort(v: string | string[] | undefined): ContentSort {
  const k = Array.isArray(v) ? v[0] : v;
  return CONTENT_SORTS.some((f) => f.key === k) ? (k as ContentSort) : "clicks";
}

export function applyFilterSort(
  rows: ContentRow[],
  filter: ContentFilter,
  sort: ContentSort,
): ContentRow[] {
  let out = rows;
  if (filter === "measured") out = out.filter((r) => r.clicks !== null);
  else if (filter === "nodata") out = out.filter((r) => r.clicks === null);
  // ★「落ちた」は前期間より順位が下がった記事。0.5位以上の下落だけ拾う
  //   （0.1位の揺れを混ぜると本当に落ちた記事が埋もれる）
  else if (filter === "dropped")
    out = out.filter((r) => r.positionDelta !== null && r.positionDelta <= -0.5);
  else if (filter === "untagged") out = out.filter(isUntagged);
  else if (filter === "corporate") out = out.filter((r) => r.audience.includes("corporate"));
  else if (filter === "sole_proprietor")
    out = out.filter((r) => r.audience.includes("sole_proprietor"));
  else if (filter === "comparison") out = out.filter((r) => r.contentFormat === "comparison");
  else if (filter === "pillar") out = out.filter((r) => r.isPillar);

  const nz = (n: number | null) => (n === null ? -1 : n);
  const sorted = [...out];
  if (sort === "clicks") sorted.sort((a, b) => nz(b.clicks) - nz(a.clicks));
  else if (sort === "leads") sorted.sort((a, b) => b.leads - a.leads || nz(b.clicks) - nz(a.clicks));
  else if (sort === "pv") sorted.sort((a, b) => nz(b.pv) - nz(a.pv));
  else if (sort === "delta")
    // 落ち幅が大きい順（直したい記事を上に）
    sorted.sort((a, b) => (a.positionDelta ?? 999) - (b.positionDelta ?? 999));
  else if (sort === "position")
    // 順位は小さいほど良い。未計測は末尾
    sorted.sort((a, b) => (a.avgPosition ?? 999) - (b.avgPosition ?? 999));
  else if (sort === "published")
    sorted.sort(
      (a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0),
    );
  return sorted;
}

// ── 詳細 ──────────────────────────────────────────────

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
  audience: string[];
  contentFormat: string | null;
  budgetTier: string;
  funnelStage: string | null;
  freshnessTier: string | null;
  note: string | null;
  /** この記事が初回接点だったリード */
  leads: { occurredAt: Date; status: string; sourceType: string }[];
  /** 日次の系列（clicks / impressions / position / pv） */
  series: {
    date: string;
    clicks: number | null;
    impressions: number | null;
    position: number | null;
    pv: number | null;
  }[];
};

export async function getContentDetail(
  externalId: string,
  range: Range,
): Promise<ContentDetail | null> {
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
      audience: true,
      contentFormat: true,
      budgetTier: true,
      funnelStage: true,
      freshnessTier: true,
      note: true,
    },
  });
  if (!it) return null;

  const [metrics, leads] = await Promise.all([
    prisma.contentMetric.findMany({
      where: {
        contentItemId: it.id,
        metric: { in: ["clicks", "impressions", "position", "pv"] },
        date: range.dateWindow,
      },
      orderBy: { date: "asc" },
      select: { metric: true, value: true, date: true },
    }),
    prisma.lead.findMany({
      where: { firstTouchContentId: it.id },
      orderBy: { occurredAt: "desc" },
      select: { occurredAt: true, status: true, sourceType: true },
    }),
  ]);

  const byDate = new Map<
    string,
    { clicks: number | null; impressions: number | null; position: number | null; pv: number | null }
  >();
  for (const m of metrics) {
    const key = jstDayKey(m.date);
    const row = byDate.get(key) ?? { clicks: null, impressions: null, position: null, pv: null };
    (row as Record<string, number | null>)[m.metric] = ROUND1(m.value);
    byDate.set(key, row);
  }
  const series = [...byDate.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, v]) => ({ date, ...v }));

  return { ...it, title: decodeEntities(it.title), leads, series };
}
