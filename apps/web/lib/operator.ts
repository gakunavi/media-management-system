// operator の立案ロジック（設計書 §5.2 / §7.5.2 / §13.3 / §3.5.2）
//
// ★システムの頭脳。既存の実測データから「次の一手（Action）」を自動起票する。
//   §9.4.2 の注意に従い、AIが1本ずつ判定するのではなく **ルール＋一括処理** で作る。
//   起票された Action は段5に並び、人が承認/却下する（責任は人に残す・§12.3）。
import { prisma, type Prisma } from "@mms/db";
import { decodeEntities } from "./content";
import { resolveRange } from "./period";
import { getThreadsData } from "./threads";

const DAY = 86400000;

/** 打ち手タイプごとの判定期間（日）。docs/GLOSSARY.md §5.1 */
export const JUDGE_DAYS: Record<string, number> = {
  // 本文リライトと統合は効果が出るまで時間がかかる（再クロール＋再評価）
  rewrite: 28,
  merge: 56,
  title_meta_rewrite: 28,
  cta_move: 14,
  cta_variant: 14,
  lp_section_edit: 14,
  internal_link: 28,
  new_article: 56,
  kw_pivot: 56,
  threads_format_shift: 14,
  stop_low_fit: 28,
};

type Proposal = {
  ruleKey: string;
  /** Action.id の一意キー。記事なら externalId、KW起点なら KW slug */
  targetKey: string;
  /** 記事に紐づかない提案（新規記事の起票など）は null */
  contentItemId: string | null;
  contentExternalId: string | null;
  type: string;
  title: string;
  rationale: string;
  impacts: string[];
  signal: Record<string, unknown>;
};

/**
 * 立案を実行し、新規の Action を起票する。冪等（同じ根拠の重複は作らない）。
 * @returns 新規起票した件数
 */
export async function generateProposals(): Promise<{ created: number; scanned: number }> {
  const business = await prisma.business.findFirst({
    where: { slug: process.env.MMS_DEFAULT_BUSINESS_SLUG ?? "tax-saving-agency" },
    select: { id: true },
  });
  if (!business) return { created: 0, scanned: 0 };

  const proposals = [
    ...(await proposeFromArticleMetrics()),
    ...(await proposeFromWeakPillars()),
    ...(await proposeFromSerp()),
    ...(await proposeFromThreadsFormats()),
  ];

  let created = 0;
  for (const p of proposals) {
    const id = `act_op_${p.ruleKey}_${p.targetKey}`;
    // ★既に同じ id の Action があれば作らない（却下済みなら §5.6 の意思を尊重）
    const exists = await prisma.action.findUnique({ where: { id }, select: { id: true } });
    if (exists) continue;

    await prisma.action.create({
      data: {
        id,
        businessId: business.id,
        type: p.type as Prisma.ActionCreateInput["type"],
        title: p.title,
        rationale: p.rationale,
        impacts: p.impacts,
        proposedBy: "operator:v1",
        state: "proposed",
        preparedArtifact: {
          contentItemId: p.contentItemId,
          contentExternalId: p.contentExternalId,
          signal: p.signal,
          evaluateDays: JUDGE_DAYS[p.type] ?? 28,
        } as Prisma.InputJsonValue,
        // §16.6-3 承認待ちの滞留対策: 14日で自動 expired
        expiresAt: new Date(Date.now() + 14 * DAY),
      },
    });
    created += 1;
  }

  return { created, scanned: proposals.length };
}

/**
 * 記事の実測から立案:
 *   Rule A（CTR異常・§7.5.2）: 表示は多いが順位が悪くないのにクリックが極小 → title_meta_rewrite
 *   Rule B（striking distance・§13.3）: 平均順位11-20位 → title_meta_rewrite（1ページ目に押し上げ）
 */
async function proposeFromArticleMetrics(): Promise<Proposal[]> {
  const items = await prisma.contentItem.findMany({
    where: { type: "article" },
    select: { id: true, externalId: true, title: true },
  });
  if (items.length === 0) return [];

  const latest = await prisma.contentMetric.findFirst({
    where: { metric: "clicks" },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  const latestDate = latest?.date ?? new Date();
  const since28 = new Date(latestDate.getTime() - 27 * DAY);
  const since7 = new Date(latestDate.getTime() - 6 * DAY);

  const [sums, pos7] = await Promise.all([
    prisma.contentMetric.groupBy({
      by: ["contentItemId", "metric"],
      where: { metric: { in: ["clicks", "impressions"] }, date: { gte: since28, lte: latestDate } },
      _sum: { value: true },
    }),
    prisma.contentMetric.groupBy({
      by: ["contentItemId"],
      where: { metric: "position", date: { gte: since7, lte: latestDate } },
      _avg: { value: true },
    }),
  ]);

  const clicksBy = new Map<string, number>();
  const imprBy = new Map<string, number>();
  for (const r of sums) {
    if (r.metric === "clicks") clicksBy.set(r.contentItemId, r._sum.value ?? 0);
    else imprBy.set(r.contentItemId, r._sum.value ?? 0);
  }
  const posBy = new Map(pos7.map((r) => [r.contentItemId, r._avg.value]));

  // ★AI Overview が出るKWで上位に居る記事は Rule A の対象から外す。
  //   CTRが低い原因が「タイトルが弱い」ではなく「AIOがクリックを吸っている」
  //   可能性が高く、同じ症状に別の診断を出すと打ち手を誤らせる。
  //   その領域は Rule D（aio_ctr）が別の根拠で提案する。
  const aioAffected = await aioAffectedArticleIds();

  const out: Proposal[] = [];
  for (const it of items) {
    const clicks = Math.round(clicksBy.get(it.id) ?? 0);
    const impr = Math.round(imprBy.get(it.id) ?? 0);
    const pos = posBy.get(it.id);
    if (pos == null || impr < 50) continue; // 表示が薄い記事は対象外
    const title = decodeEntities(it.title);
    const ctr = impr > 0 ? clicks / impr : 0;

    if (pos >= 11 && pos <= 20) {
      // Rule B: striking distance
      out.push({
        ruleKey: "striking",
        targetKey: it.externalId,
        contentItemId: it.id,
        contentExternalId: it.externalId,
        type: "title_meta_rewrite",
        title: `[striking] ${it.externalId} を1ページ目へ`,
        rationale:
          `平均順位 ${pos.toFixed(1)}位（11-20位＝あと少しで1ページ目）・表示 ${impr}/28日。` +
          `タイトル/メタ改善でCTRと順位の底上げを狙う（§13.3）。対象: ${title}`,
        impacts: ["position", "clicks", "CTR"],
        signal: { avgPosition: pos, impressions28: impr, clicks28: clicks },
      });
    } else if (pos <= 10 && ctr < 0.01 && clicks <= 3 && !aioAffected.has(it.id)) {
      // Rule A: CTR異常（見えているのに押されない）
      // ★AIOが出るKWの記事はここに来ない（Rule D が担当）
      out.push({
        ruleKey: "ctr",
        targetKey: it.externalId,
        contentItemId: it.id,
        contentExternalId: it.externalId,
        type: "title_meta_rewrite",
        title: `[CTR異常] ${it.externalId} のタイトル/メタ改善`,
        rationale:
          `順位 ${pos.toFixed(1)}位で1ページ目なのに表示 ${impr}/28日に対しクリック ${clicks}（CTR ${(ctr * 100).toFixed(1)}%）。` +
          `タイトル/メタが刺さっていない可能性（§7.5.2）。対象: ${title}`,
        impacts: ["CTR", "clicks"],
        signal: { avgPosition: pos, impressions28: impr, clicks28: clicks, ctr },
      });
    }
  }
  // 表示が多い順（機会が大きい順）に上位を採用
  out.sort((a, b) => (b.signal.impressions28 as number) - (a.signal.impressions28 as number));
  return out.slice(0, 12);
}

/**
 * AI Overview が出るKWで自社が1ページ目に居る記事の集合。
 * Rule A（CTR異常＝タイトルが弱い）の診断から除外するために使う。
 */
async function aioAffectedArticleIds(): Promise<Set<string>> {
  const latest = await prisma.serpSnapshot.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!latest) return new Set();

  const rows = await prisma.serpSnapshot.findMany({
    where: { date: latest.date, isOurs: true, hasAiOverview: true, position: { lte: 10 } },
    select: { url: true },
  });
  if (rows.length === 0) return new Set();

  const norm = (u: string | null) => (u ?? "").replace(/\/+$/, "").toLowerCase();
  const urls = new Set(rows.map((r) => norm(r.url)));
  const articles = await prisma.contentItem.findMany({
    where: { type: "article" },
    select: { id: true, url: true },
  });
  return new Set(articles.filter((a) => urls.has(norm(a.url))).map((a) => a.id));
}

/**
 * SERP実測（SerpSnapshot・§3.3.5 / §3.3.6）からの立案。
 *
 * ★GSC は「自分の順位」しか返さない。誰に負けているか・AI Overview が出ているかは
 *   SERP実測でしか分からない。ここが無いと、下の2つを取り違える:
 *
 *   Rule D（AIO食われ）: 1ページ目なのにCTRが低い理由が「タイトルが弱い」ではなく
 *     「AI Overview がクリックを吸っている」ケース。Rule A と原因も打ち手も違う。
 *   Rule E（自社不在）: Googleが関連と認識して表示は出しているのに、SERP20位以内に
 *     自社が1本も無い＝そのKWに対応する記事が存在しない。リライトではなく新規作成。
 */
/**
 * KW単位の「機会あり」とみなす表示回数（28日）。
 *
 * ★実データに合わせて較正した値（2026-07-21 時点）。KeywordRanking は
 *   GSCのクエリ別エクスポート由来でサンプリングが効いており、293KWの
 *   中央値は 3 表示/28日、最大 210 しかない。当初 100/300 と置いていたが
 *   該当が 2件/0件で、事実上ルールが死んでいた。
 * ★この規模では統計的な確度は低い。根拠文に表示回数を明記し、
 *   人が「この母数で判断してよいか」を見られるようにする（§16.5 の考え方）。
 */
const KW_MIN_IMPRESSIONS = 30;

/**
 * 上位が官公庁（go.jp）で占められているKWへの注意書き。
 *
 * ★「中小企業経営強化税制」「即時償却」のような制度名KWは、上位が
 *   中小企業庁・国税庁の一次情報で埋まる。ここに新規記事で正面から
 *   挑んでも順位は取れない。承認前にそれが見えていないと、書いてから
 *   気づくことになる。打ち手を「制度解説」から「事例・比較・実務」へ
 *   ずらす判断材料として根拠文に入れる。
 */
function officialWarning(topDomains: string[]): string {
  const official = topDomains.filter((d) => d.endsWith(".go.jp"));
  if (official.length === 0) return "";
  return (
    `／⚠️ 上位に官公庁の一次情報（${official.join(" / ")}）。` +
    `制度解説で正面から競っても順位は取りにくい。事例・比較・実務手順など` +
    `一次情報が扱わない切り口に寄せる検討を。`
  );
}

async function proposeFromSerp(): Promise<Proposal[]> {
  const latestSerp = await prisma.serpSnapshot.findFirst({
    orderBy: { date: "desc" },
    select: { date: true },
  });
  if (!latestSerp) return []; // ★SERP未取得なら何も言わない（推測で提案しない）

  const [snapshots, keywords, articles] = await Promise.all([
    prisma.serpSnapshot.findMany({
      where: { date: latestSerp.date },
      select: { keywordId: true, position: true, domain: true, url: true, isOurs: true, hasAiOverview: true },
      orderBy: { position: "asc" },
    }),
    prisma.keyword.findMany({ select: { id: true, keyword: true, slug: true } }),
    prisma.contentItem.findMany({
      where: { type: "article" },
      select: { id: true, externalId: true, title: true, url: true },
    }),
  ]);

  const kwById = new Map(keywords.map((k) => [k.id, k]));
  const normUrl = (u: string | null) => (u ?? "").replace(/\/+$/, "").toLowerCase();
  const articleByUrl = new Map(articles.map((a) => [normUrl(a.url), a]));

  // KWごとに「AIOの有無 / 自社の最上位 / 上位3ドメイン」へ畳む
  type Agg = { hasAio: boolean; ourPos: number | null; ourUrl: string | null; top: string[] };
  const aggByKw = new Map<string, Agg>();
  for (const s of snapshots) {
    let a = aggByKw.get(s.keywordId);
    if (!a) {
      a = { hasAio: s.hasAiOverview, ourPos: null, ourUrl: null, top: [] };
      aggByKw.set(s.keywordId, a);
    }
    if (a.top.length < 3) a.top.push(s.domain);
    if (s.isOurs && a.ourPos === null) {
      a.ourPos = s.position;
      a.ourUrl = s.url;
    }
  }

  // GSC 直近28日の表示・クリック（KW単位）
  const since = new Date(latestSerp.date.getTime() - 27 * DAY);
  const gsc = await prisma.keywordRanking.groupBy({
    by: ["keywordId"],
    where: { date: { gte: since } },
    _sum: { impressions: true, clicks: true },
  });
  const gscBy = new Map(
    gsc.map((r) => [r.keywordId, { impr: r._sum.impressions ?? 0, clicks: r._sum.clicks ?? 0 }]),
  );

  const out: Proposal[] = [];
  for (const [kwId, agg] of aggByKw) {
    const kw = kwById.get(kwId);
    const g = gscBy.get(kwId);
    if (!kw || !g || g.impr < KW_MIN_IMPRESSIONS) continue; // 表示が薄いKWは機会が小さい
    const ctr = g.impr > 0 ? g.clicks / g.impr : 0;

    if (agg.hasAio && agg.ourPos !== null && agg.ourPos <= 10 && ctr < 0.02) {
      // Rule D: AI Overview にクリックを吸われている疑い
      const art = agg.ourUrl ? articleByUrl.get(normUrl(agg.ourUrl)) : undefined;
      out.push({
        ruleKey: "aio_ctr",
        targetKey: kw.slug,
        contentItemId: art?.id ?? null,
        contentExternalId: art?.externalId ?? null,
        type: "title_meta_rewrite",
        title: `[AIO対策]「${kw.keyword}」— 上位なのにクリックが取れていない`,
        rationale:
          `SERP実測で AI Overview が表示されるKW。自社は ${agg.ourPos}位（1ページ目）だが ` +
          `表示 ${g.impr}/28日に対しクリック ${g.clicks}（CTR ${(ctr * 100).toFixed(1)}%）。` +
          `★タイトルが弱いのではなく、AIOが回答を先に出してクリックを吸っている可能性が高い（§3.3.6）。` +
          `打ち手は「結論を冒頭に置く」「AIOが引用しやすい構造にする」であって、煽りタイトルではない。` +
          `上位: ${agg.top.join(" / ")}${art ? `。対象: ${decodeEntities(art.title)}` : "（対応記事を特定できず）"}` +
          `／★母数は表示 ${g.impr} と小さい。傾向の示唆であって確定ではない`,
        impacts: ["CTR", "clicks"],
        signal: {
          keyword: kw.keyword,
          serpPosition: agg.ourPos,
          hasAiOverview: true,
          impressions28: g.impr,
          clicks28: g.clicks,
          ctr,
          topDomains: agg.top,
        },
      });
    } else if (agg.ourPos === null) {
      // Rule E: 表示は出ているのに20位以内に自社が1本も無い＝記事が無い
      out.push({
        ruleKey: "serp_absent",
        targetKey: kw.slug,
        contentItemId: null,
        contentExternalId: null,
        type: "new_article",
        title: `[記事なし]「${kw.keyword}」に対応する記事を作る`,
        rationale:
          `Googleは関連と認識して表示 ${g.impr}/28日を出しているが、SERP20位以内に自社が1本も無い。` +
          `既存記事のリライトでは届かない＝新規作成の対象（§3.3.5）。` +
          `上位を取っているのは ${agg.top.join(" / ")}。` +
          officialWarning(agg.top) +
          `／★母数は表示 ${g.impr} と小さい。傾向の示唆であって確定ではない`,
        impacts: ["impressions", "clicks", "position"],
        signal: {
          keyword: kw.keyword,
          serpPosition: null,
          impressions28: g.impr,
          clicks28: g.clicks,
          topDomains: agg.top,
        },
      });
    }
  }

  out.sort((a, b) => (b.signal.impressions28 as number) - (a.signal.impressions28 as number));
  return out.slice(0, 10);
}

/**
 * Rule F（threads_format_shift）: Threads のフォーマット別の効きが偏っているとき、
 * 低調なフォーマットの配分を高調なフォーマットへ寄せることを提案する。
 *
 * ★根拠は /threads 画面でそのまま確認できる（承認前に人が見られる）。
 * ★未計測の投稿は平均から除外する。0として混ぜると低調フォーマットが
 *   実際より悪く見え、まだ効いているものを切ってしまう（§3）。
 */
async function proposeFromThreadsFormats(): Promise<Proposal[]> {
  // ★立案は直近90日の実績で行う（1か月だと比較できる型が揃わない）
  const { summary, byFormat } = await getThreadsData(resolveRange({ range: "d90" }));
  const median = summary.medianFormatAvg;
  if (median === null) return []; // 母数が足りず基準を作れない

  // 平均を出せた（＝計測済がMIN_POSTS_FOR_STAT件以上）フォーマットだけを比較する
  // ★「その他」（少数の型を畳んだ行）は比較対象にしない。中身が別の型なので
  //   これを最下位として提案に使うと、存在しない型を「減らせ」と言うことになる
  const rated = byFormat.rows.filter((g) => !g.isOther && g.avgViews !== null);
  if (rated.length < 3) return []; // 比較対象が少なすぎると「偏り」を語れない

  const best = rated[0]; // avgViews 降順
  const worst = rated[rated.length - 1];
  if (best.avgViews === null || worst.avgViews === null) return [];
  // 最下位が中央値の6割未満、かつ最上位と2倍以上の開きがあるときだけ提案する
  if (worst.avgViews >= median * 0.6) return [];
  if (best.avgViews < worst.avgViews * 2) return [];

  return [
    {
      ruleKey: "threads_format",
      targetKey: slugify(worst.name),
      contentItemId: null,
      contentExternalId: null,
      type: "threads_format_shift",
      title: `[Threads配分]「${worst.name}」を減らし「${best.name}」に寄せる`,
      rationale:
        `フォーマット別の平均views: ${worst.name} ${worst.avgViews.toLocaleString("ja-JP")}` +
        `（${worst.measured}投稿・中央値比 ×${(worst.avgViews / median).toFixed(1)}）に対し、` +
        `${best.name} ${best.avgViews.toLocaleString("ja-JP")}（${best.measured}投稿・` +
        `×${(best.avgViews / median).toFixed(1)}）で ` +
        `${(best.avgViews / worst.avgViews).toFixed(1)}倍の開き。` +
        `低調なフォーマットの投稿枠を高調な方へ振り替える。` +
        `／★これは期間を揃えていない単純平均であり、投稿時期の違い（開設直後は` +
        `リーチが低い）を含む。/threads で内訳を確認してから判断すること。`,
      impacts: ["threads_views", "impressions"],
      signal: {
        worstFormat: worst.name,
        worstAvgViews: worst.avgViews,
        worstPosts: worst.measured,
        bestFormat: best.name,
        bestAvgViews: best.avgViews,
        bestPosts: best.measured,
        medianFormatAvg: median,
        unmeasuredPosts: summary.unmeasured,
      },
    },
  ];
}

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9ぁ-んァ-ン一-龥]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Rule C（§3.5.2）: 宣言ピラーだが被リンクが少ない（権威が集約されていない）
 *   → internal_link（クラスター→ピラーのリンクを増やす）
 */
async function proposeFromWeakPillars(): Promise<Proposal[]> {
  const [pillars, incoming] = await Promise.all([
    prisma.contentItem.findMany({
      where: { type: "article", isPillar: true },
      select: { id: true, externalId: true, title: true },
    }),
    prisma.internalLink.groupBy({ by: ["dstContentId"], _count: { _all: true } }),
  ]);
  const incBy = new Map(incoming.map((r) => [r.dstContentId, r._count._all]));

  // 全記事の被リンク中央値
  const all = await prisma.contentItem.findMany({
    where: { type: "article" },
    select: { id: true },
  });
  const vals = all
    .map((a) => incBy.get(a.id) ?? 0)
    .filter((v) => v > 0)
    .sort((x, y) => x - y);
  const median = vals.length ? vals[Math.floor(vals.length / 2)] : 0;

  const out: Proposal[] = [];
  for (const p of pillars) {
    const inc = incBy.get(p.id) ?? 0;
    if (inc >= median) continue; // 十分な被リンクがあるピラーは対象外
    out.push({
      ruleKey: "weakpillar",
      targetKey: p.externalId,
      contentItemId: p.id,
      contentExternalId: p.externalId,
      type: "internal_link",
      title: `[弱いピラー] ${p.externalId} へのクラスター→ピラー リンク追加`,
      rationale:
        `宣言ピラーだが被リンク ${inc}本（中央値 ${median}本 未満）＝権威が集約されていない（§3.5.2）。` +
        `関連クラスター記事から本記事へのリンクを追加し、ハブとして機能させる。対象: ${decodeEntities(p.title)}`,
      impacts: ["回遊", "lp_view"],
      signal: { incoming: inc, median },
    });
  }
  return out;
}
