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
//   rakko_paa  … ラッコで取得した PAA（Googleが実際に表示している「他の人はこちらも質問」）
//                のうち、**自社が記事を持っていないKW**の質問（§13.4-②）
//
//   ★未実装: gsc_gap / news（News=P6）
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
    ...(await fromRakkoQuestions(business.id)),
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

/**
 * PAA（他の人はこちらも質問）からネタを作る（§13.4-② IdeaSource.rakko_paa）。
 *
 * ★「未回答のもの」をどう判定するか
 *   本来は自社記事の本文と突き合わせたいが、wp_sync は本文を取得していない
 *   （§3.9.1「本文全体は比較しない＝軽量」）。つまり**回答済みかは判定できない**。
 *   そこで、**記事が1本も割り当たっていないKW**の質問だけを対象にする。
 *   記事が無い以上そのKWの質問に答えていないことは確実で、推測が入らない。
 *   記事があるKWの質問は「答えているかもしれない」ので起票しない（ノイズを出さない）。
 *
 * ★PAA を優先する。suggest 派生や合成された質問は、キーワードを疑問文に
 *   言い換えただけのことがあり、実際に検索されている保証がない。
 */
async function fromRakkoQuestions(_businessId: string): Promise<IdeaDraft[]> {
  // ★JSON列のnull判定は Prisma.DbNull（値）が要るが、ここは type import しか
  //   していないので、取得後にJS側で弾く。件数は数十件なので問題にならない
  const research = await prisma.keywordResearch.findMany({
    where: {
      source: "rakko",
      // ★記事が割り当たっていないKWだけ（＝確実に未回答）
      keyword: { assignments: { none: {} } },
    },
    orderBy: { fetchedAt: "desc" },
    include: { keyword: { select: { keyword: true } } },
  });

  // ソース表記が10種類に揺れているため正規化する（PAA / rakko_paa / paa / lsi/paa …）
  const isPaa = (v: unknown) => /paa/i.test(String(v ?? ""));

  const seen = new Set<string>();
  const out: IdeaDraft[] = [];

  for (const r of research) {
    const kw = r.keyword.keyword;
    // ★検証用に作られた「テスト」KW を混ぜない
    if (/^テスト$/i.test(kw.trim())) continue;

    const items = Array.isArray(r.qaQuestions) ? r.qaQuestions : [];
    const questions = items
      .filter((q): q is { question: string; source?: string } =>
        typeof q === "object" && q !== null && typeof (q as { question?: unknown }).question === "string",
      )
      .filter((q) => isPaa(q.source))
      .map((q) => q.question.trim())
      .filter((q) => q.length > 0);

    for (const q of questions) {
      if (seen.has(q)) continue;
      seen.add(q);
      out.push({
        title: `[PAA] ${q}`,
        body:
          `Googleが「${kw}」の検索結果に表示している質問（他の人はこちらも質問）。` +
          `★このKWには自社記事が1本も割り当たっていないため、未回答であることは確実。` +
          `／PAAは検索結果に出ている＝実際に需要がある質問で、疑問文に言い換えただけの` +
          `キーワードとは違う（§13.4-②）。`,
        source: "rakko_paa",
        sourceRef: { keyword: kw, question: q } as Prisma.InputJsonValue,
        impacts: ["impressions", "clicks"],
        state: "new",
        keywordId: r.keywordId,
      });
    }
  }
  return out.slice(0, 15);
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
  rakko_paa: "PAA質問",
  gsc_gap: "GSCギャップ",
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
