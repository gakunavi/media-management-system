// 記事ネタの自動供給（設計書 §4.2 /ideas・§13.4-④・IdeaSource）
//
// ★「ネタが尽きる」を仕組みで潰す。書き手が題材を考える時間をゼロにするのが目的。
//   設計書の5供給源のうち、実データが揃った2つを実装する:
//
//   threads_hit … 平均の1.5倍跳ねた Threads 投稿を記事化ネタにする（§13.4-④）
//                 「チャネル間でネタが循環する」＝SNSで反応が取れた話題は
//                 検索でも需要がある可能性が高い、という仮説に基づく
//   aio_miss   … AI Overview に競合は引用されているのに自社は引用されていないKW。
//                 順位が取れていても引用されなければクリックは競合に行く（§3.3.6）
//
//   ★未実装: gsc_gap / rakko_paa / news（ラッコ連携=P4.5、News=P6）
import { prisma, type Prisma } from "@mms/db";

/** 直近何日の実績を見るか。Threads は投稿頻度が高いので90日で十分な母数になる */
const LOOKBACK_DAYS = 90;
const DAY = 86400000;

/** §13.4-④「平均の1.5倍跳ねた投稿」 */
const HIT_RATIO = 1.5;

/**
 * ネタが「跳ねた」と判定するのに必要な最低母数。
 * ★母数が小さいと平均自体が不安定で、1.5倍に意味が無くなる（§16.5 の考え方）
 */
const MIN_POSTS_FOR_AVG = 20;

export type IdeaGenResult = { created: number; scanned: number };

export async function generateIdeas(): Promise<IdeaGenResult> {
  const business = await prisma.business.findFirst({
    where: { slug: process.env.MMS_DEFAULT_BUSINESS_SLUG ?? "tax-saving-agency" },
    select: { id: true },
  });
  if (!business) return { created: 0, scanned: 0 };

  const drafts = [
    ...(await fromThreadsHits(business.id)),
    ...(await fromAioMisses(business.id)),
  ];

  let created = 0;
  for (const d of drafts) {
    // 冪等: 同じ供給源・同じ対象のネタは作り直さない
    const exists = await prisma.idea.findFirst({
      where: { source: d.source, title: d.title },
      select: { id: true },
    });
    if (exists) continue;
    await prisma.idea.create({ data: { ...d, businessId: business.id } });
    created += 1;
  }
  return { created, scanned: drafts.length };
}

type IdeaDraft = Omit<Prisma.IdeaUncheckedCreateInput, "businessId">;

/**
 * §13.4-④: 平均の1.5倍以上 views が跳ねた Threads 投稿を記事化ネタにする。
 */
async function fromThreadsHits(_businessId: string): Promise<IdeaDraft[]> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY);

  const posts = await prisma.contentItem.findMany({
    where: {
      type: "post",
      publishedAt: { gte: since },
      channel: { type: "threads" },
    },
    select: { id: true, externalId: true, title: true, note: true, publishedAt: true },
  });
  if (posts.length < MIN_POSTS_FOR_AVG) return [];

  const views = await prisma.contentMetric.groupBy({
    by: ["contentItemId"],
    where: { metric: "threads_views", contentItemId: { in: posts.map((p) => p.id) } },
    _max: { value: true },
  });
  // ★未計測（ContentMetric が無い）投稿は平均の計算から除く。
  //   0 として混ぜると平均が下がり、跳ねていない投稿まで「ヒット」になる（§3）
  const viewBy = new Map(views.map((v) => [v.contentItemId, v._max.value ?? 0]));
  const measured = posts.filter((p) => viewBy.has(p.id));
  if (measured.length < MIN_POSTS_FOR_AVG) return [];

  const avg =
    measured.reduce((s, p) => s + (viewBy.get(p.id) ?? 0), 0) / measured.length;
  if (avg <= 0) return [];

  const hits = measured
    .map((p) => ({ p, v: viewBy.get(p.id) ?? 0 }))
    .filter((x) => x.v >= avg * HIT_RATIO)
    .sort((a, b) => b.v - a.v)
    .slice(0, 10);

  return hits.map(({ p, v }) => ({
    title: `[Threads反響] ${firstLine(p.title)} を記事化`,
    body:
      `Threads投稿 ${p.externalId}（${p.note ?? "フォーマット不明"}）が ${Math.round(v).toLocaleString("ja-JP")} views。` +
      `直近${LOOKBACK_DAYS}日の平均 ${Math.round(avg).toLocaleString("ja-JP")} views の ` +
      `${(v / avg).toFixed(1)}倍（母数 ${measured.length}投稿）。` +
      `SNSで反応が取れた話題は検索でも需要がある可能性が高い（§13.4-④ チャネル間でネタが循環する）。` +
      `★これは仮説であって検索需要の実測ではない。記事化前にKWのボリュームを確認すること。`,
    source: "threads_hit",
    sourceRef: {
      contentItemId: p.id,
      externalId: p.externalId,
      views: v,
      avgViews: Math.round(avg),
      ratio: Number((v / avg).toFixed(2)),
      sampleSize: measured.length,
    } as Prisma.InputJsonValue,
    impacts: ["impressions", "clicks"],
    state: "new",
    contentItemId: p.id,
  }));
}

/**
 * AI Overview に競合は引用されているのに自社は引用されていないKW（IdeaSource.aio_miss）。
 *
 * ★順位が取れていても、AIOに引用されなければクリックはそちらに流れる（§3.3.6）。
 *   「何位か」ではなく「引用されているか」が問われる領域が増えている。
 */
async function fromAioMisses(_businessId: string): Promise<IdeaDraft[]> {
  const latest = await prisma.serpSnapshot.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!latest) return [];

  const rows = await prisma.serpSnapshot.findMany({
    where: { date: latest.date, hasAiOverview: true },
    select: {
      keywordId: true,
      position: true,
      domain: true,
      isOurs: true,
      aioCitedDomains: true,
    },
    orderBy: { position: "asc" },
  });

  type Agg = { cited: string[]; ourPos: number | null; ourDomain: string | null };
  const byKw = new Map<string, Agg>();
  for (const r of rows) {
    let a = byKw.get(r.keywordId);
    if (!a) {
      a = { cited: r.aioCitedDomains, ourPos: null, ourDomain: null };
      byKw.set(r.keywordId, a);
    }
    if (r.isOurs && a.ourPos === null) {
      a.ourPos = r.position;
      a.ourDomain = r.domain;
    }
  }

  const keywords = await prisma.keyword.findMany({ select: { id: true, keyword: true } });
  const kwById = new Map(keywords.map((k) => [k.id, k]));

  const out: IdeaDraft[] = [];
  for (const [kwId, a] of byKw) {
    // ★引用元が空 = 「引用ゼロ」ではなく「未計測」の可能性がある（有料オプション未使用）。
    //   区別できないので、引用が1件以上取れているKWだけを対象にする（§3）
    if (a.cited.length === 0) continue;
    if (a.ourPos === null || a.ourPos > 10) continue; // 1ページ目に居ないKWは別問題
    const ours = a.ourDomain ?? "";
    if (a.cited.some((d) => d === ours || d.endsWith("." + ours))) continue; // 既に引用されている

    const kw = kwById.get(kwId);
    if (!kw) continue;

    out.push({
      title: `[AIO未引用]「${kw.keyword}」— 上位なのにAI Overviewに引用されていない`,
      body:
        `自社は ${a.ourPos}位で1ページ目に居るが、AI Overview の引用元は ` +
        `${a.cited.slice(0, 5).join(" / ")}（計${a.cited.length}社）で自社が入っていない。` +
        `順位が取れていても引用されなければクリックはそちらに流れる（§3.3.6）。` +
        `引用されている記事の構造（結論の位置・定義の書き方・数値の示し方）を確認し、` +
        `該当記事を引用されやすい形に組み直す。`,
      source: "aio_miss",
      sourceRef: {
        keyword: kw.keyword,
        ourPosition: a.ourPos,
        citedDomains: a.cited,
      } as Prisma.InputJsonValue,
      impacts: ["clicks", "CTR"],
      state: "new",
      keywordId: kwId,
    });
  }
  return out.slice(0, 10);
}

function firstLine(s: string, max = 40): string {
  const line = (s ?? "").split("\n").find((l) => l.trim()) ?? "";
  return line.trim().slice(0, max);
}

export type IdeaRow = {
  id: string;
  title: string;
  body: string | null;
  source: string;
  impacts: string[];
  state: string;
  createdAt: Date;
};

export const IDEA_SOURCE_LABEL: Record<string, string> = {
  threads_hit: "Threads反響",
  aio_miss: "AIO未引用",
  gsc_gap: "GSCギャップ",
  rakko_paa: "PAA",
  news: "News",
  lead_competitor: "競合",
  manual: "手動",
};

export async function getIdeas(): Promise<IdeaRow[]> {
  const rows = await prisma.idea.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      body: true,
      source: true,
      impacts: true,
      state: true,
      createdAt: true,
    },
    take: 200,
  });
  return rows;
}
