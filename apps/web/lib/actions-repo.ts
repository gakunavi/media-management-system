// 段5「次の一手」の取得（設計書 §4.1 段5・§5.2）
//
// ★なぜ並べ替えと絞り込みが要るか（2026-07-24）
//   承認待ちが23件あるのに、処理能力は週2〜3本（cowork 実績）。
//   全部を同じ重みで並べると、上から順に見て力尽きるだけになる。
//   ★元の並び順は `impacts.length`（影響する指標の数）だった。これは
//     「効きそうか」ではなく「説明文に何個書いたか」で、根拠になっていない。
//
// ★判定待ちの記事に重ねて提案しない。
//   同じ記事に続けて手を入れると、**どちらの効果か分からなくなる**。
//   実測（2026-07-24）で3件が該当し、うち ART-101 は
//   進行中と**同じ title-meta-rewrite** を重ねて提案していた。
import { prisma } from "@mms/db";
import { isNavigational } from "./search-queries";

export type ProposedAction = {
  id: string;
  type: string;
  title: string;
  rationale: string;
  impacts: string[];
  contentExternalId: string | null;
  evaluateDays: number | null;
  createdAt: Date;
  expiresAt: Date | null;
  /** 28日の表示回数。取り逃している需要の大きさ */
  impressions28: number | null;
  clicks28: number | null;
  avgPosition: number | null;
  /**
   * 同じ記事で判定待ちの打ち手が動いている。
   * ★重ねると効果が分離できない。判定が終わるまで待つ
   */
  blockedBy: { type: string; evaluateAt: Date } | null;
  /**
   * 表示の大半が「国税庁 …」型の指名検索。
   * ★§4-24: 利用者は公式ページを開きに来ているので、
   *   こちらのタイトルを直してもクリックは増えない。
   *   「表示は多いのにクリック0」という信号だけ見ると必ず上位に来るので、
   *   立案側でも除外しないと**効かない指示を優先して出す**ことになる。
   */
  navigationalShare: number | null;
  /**
   * 表示のうち、**検索語まで分かっている割合**。
   *
   * ★なぜ要るか（cowork 依頼7の回答・2026-07-24）
   *   「着手前にページ単位のクエリ内訳を確認せよ」に従って実データを見たところ、
   *   上位2件が下記だった:
   *     ART-072  ページ表示131 に対しクエリ内訳は **0行**
   *     ART-179  ページ表示166 に対しクエリ内訳は 2行（表示3）
   *   GSC は表示の少ないクエリを伏せるため、**極端に細かいクエリに散っている**と
   *   内訳が丸ごと取れない。cowork の言う「AIモード合成クエリ汚染」の典型症状で、
   *   実際 ART-061 は表示503の95%が合成クエリ・人間クエリの実順位は23.2位だった。
   *
   * ★ただし「合成クエリだから」と断定はしない（GSCの秘匿は理由を返さない）。
   *   確実に言えるのは「**どのクエリに向けてタイトルを直せばよいか分からない**」こと。
   *   それだけで title_meta_rewrite の前提が崩れる。
   */
  queryCoverage: number | null;
  /**
   * 根拠が弱い（母数が小さい）。
   * ★§16.5 母数が足りないときに率で判断しない。表示が少ないと
   *   CTRも順位も偶然で動くので、直しても効果を測れない
   */
  weakEvidence: boolean;
};

/** 根拠として扱える最小の表示回数（§16.5） */
export const MIN_IMPRESSIONS = 100;

/**
 * 表示のこの割合以上が指名検索なら、タイトル修正では効かないとみなす。
 * ★実測（ART-060）: 表示151のうち「国税庁 …」型が92件（61%）で、
 *   全部クリック0。これを「CTR異常」として最優先に出していた。
 */
export const NAV_SHARE_THRESHOLD = 0.5;

/**
 * 検索語まで分かっている表示がこの割合を下回ったら、
 * タイトル/メタ単独の提案は根拠不足とみなす。
 */
export const MIN_QUERY_COVERAGE = 0.3;

/**
 * 枠制（cowork 依頼7の回答・2026-07-24）。
 *
 * ★なぜ重み係数ではなく枠か
 *   **表示回数の単一ソートは新規記事を構造的に最下位へ沈める**。
 *   自社がSERPに不在のKWは GSC の表示がほぼ0になるので、
 *   「取り逃している表示」では新規記事の価値が原理的に測れない。
 *   係数で補正すると恣意的な数字が要るので、**枠で分ける**。
 *
 * ★内部リンクと Threads は記事枠を消費しない（1件15〜30分の軽作業）。
 *   週2〜3本の処理能力と同じ土俵で競わせない。
 */
export const MONTHLY_QUOTA = { rewrite: 6, newArticle: 4 } as const;

/** 記事1本ぶんの工数がかかる型（枠を消費する） */
const ARTICLE_WORK = new Set(["title_meta_rewrite", "rewrite", "new_article"]);

export function isArticleWork(type: string): boolean {
  return ARTICLE_WORK.has(type);
}
export function isNewArticle(type: string): boolean {
  return type === "new_article";
}

type Signal = { impressions28?: number; clicks28?: number; avgPosition?: number };

function readArtifact(a: unknown): {
  contentItemId: string | null;
  contentExternalId: string | null;
  evaluateDays: number | null;
  signal: Signal;
} {
  if (a && typeof a === "object") {
    const o = a as Record<string, unknown>;
    return {
      contentItemId: typeof o.contentItemId === "string" ? o.contentItemId : null,
      contentExternalId: typeof o.contentExternalId === "string" ? o.contentExternalId : null,
      evaluateDays: typeof o.evaluateDays === "number" ? o.evaluateDays : null,
      signal: (o.signal ?? {}) as Signal,
    };
  }
  return { contentItemId: null, contentExternalId: null, evaluateDays: null, signal: {} };
}

/**
 * 承認待ちの Action。
 *
 * 並び順は **取り逃している表示回数の多い順**。
 * ★「効きそうか」を数字で言えるのはここだけ。順位もCTRも表示が母数なので、
 *   表示が少ないものを直しても動く余地がない。
 * ★判定待ちで重なるもの・根拠が弱いものは後ろへ回す（消しはしない）。
 */
export async function getProposedActions(limit = 50): Promise<ProposedAction[]> {
  const rows = await prisma.action.findMany({
    where: { state: { in: ["proposed", "awaiting_approval"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const artifacts = rows.map((r) => readArtifact(r.preparedArtifact));
  const ids = [...new Set(artifacts.map((a) => a.contentItemId).filter(Boolean) as string[])];

  const pending = ids.length
    ? await prisma.intervention.findMany({
        where: { contentItemId: { in: ids }, verdict: "pending" },
        select: { contentItemId: true, type: true, evaluateAt: true },
      })
    : [];
  const blockedByContent = new Map(
    pending.map((p) => [p.contentItemId as string, { type: p.type, evaluateAt: p.evaluateAt }]),
  );

  // ★指名検索の割合。最新の集計期間の表示回数で見る
  const latest = await prisma.contentQuery.findFirst({
    orderBy: { periodEnd: "desc" },
    select: { periodStart: true, periodEnd: true },
  });
  const navShare = new Map<string, number>();
  const coverage = new Map<string, number>();
  if (latest && ids.length) {
    const [qs, pageImpr] = await Promise.all([
      prisma.contentQuery.findMany({
        where: {
          contentItemId: { in: ids },
          periodStart: latest.periodStart,
          periodEnd: latest.periodEnd,
        },
        select: { contentItemId: true, query: true, impressions: true },
      }),
      // ★同じ期間で比べる。28日と90日を突き合わせると割合が意味を持たない
      prisma.contentMetric.groupBy({
        by: ["contentItemId"],
        where: {
          contentItemId: { in: ids },
          metric: "impressions",
          date: { gte: latest.periodStart, lte: latest.periodEnd },
        },
        _sum: { value: true },
      }),
    ]);
    const total = new Map<string, number>();
    const nav = new Map<string, number>();
    for (const q of qs) {
      total.set(q.contentItemId, (total.get(q.contentItemId) ?? 0) + q.impressions);
      if (isNavigational(q.query)) {
        nav.set(q.contentItemId, (nav.get(q.contentItemId) ?? 0) + q.impressions);
      }
    }
    for (const [cid, t] of total) {
      if (t > 0) navShare.set(cid, (nav.get(cid) ?? 0) / t);
    }
    for (const p of pageImpr) {
      const page = p._sum.value ?? 0;
      // ★ページ表示が無ければ割合を出さない（0除算を0%と読ませない・§16.5）
      if (page > 0) {
        coverage.set(p.contentItemId, Math.min(1, (total.get(p.contentItemId) ?? 0) / page));
      }
    }
  }

  const out = rows.map((r, i) => {
    const art = artifacts[i];
    const impressions28 = art.signal.impressions28 ?? null;
    return {
      id: r.id,
      type: r.type,
      title: r.title,
      rationale: r.rationale,
      impacts: r.impacts,
      contentExternalId: art.contentExternalId,
      evaluateDays: art.evaluateDays,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      impressions28,
      clicks28: art.signal.clicks28 ?? null,
      avgPosition: art.signal.avgPosition ?? null,
      blockedBy: art.contentItemId ? (blockedByContent.get(art.contentItemId) ?? null) : null,
      navigationalShare: art.contentItemId ? (navShare.get(art.contentItemId) ?? null) : null,
      queryCoverage: art.contentItemId ? (coverage.get(art.contentItemId) ?? null) : null,
      // ★表示が取れていないものは「根拠が弱い」。null（信号なし）も同じ扱い。
      //   ただし**新規記事には適用しない**。SERPに自社が居ないので表示が少ないのは
      //   当たり前で、それを「根拠が弱い」と言うと新規記事が永久に選ばれない
      //   （cowork 依頼7: 表示回数の単一ソートが新規を構造的に沈めるのと同じ理屈）。
      // ★記事枠を使う打ち手だけに適用する。
      //   新規記事はSERPに居ないので表示が少なくて当たり前、
      //   内部リンク・Threads は判断材料が表示回数ではない（リンク構造・投稿実績）。
      //   全部に出すと「根拠が弱い」が常時表示になり、意味を失う。
      weakEvidence:
        isArticleWork(r.type) &&
        !isNewArticle(r.type) &&
        (impressions28 === null || impressions28 < MIN_IMPRESSIONS),
    };
  });

  // ① 判定待ちで重なるものは最後 ② 指名検索が主なものは後ろ
  // ③ 検索語が取れていないものは後ろ ④ 根拠が弱いものは後ろ ⑤ 表示の多い順
  //
  // ★新規記事はこの並びでは必ず下に来る（SERP不在＝表示0だから）。
  //   だから**並び順ではなく枠で確保する**（groupByQuota）。
  const navHeavy = (a: (typeof out)[number]) =>
    a.navigationalShare !== null && a.navigationalShare >= NAV_SHARE_THRESHOLD;
  // ★新規記事に「検索語が取れていない」を適用しない。SERPに居ないので当然0になる
  const noQuery = (a: (typeof out)[number]) =>
    !isNewArticle(a.type) &&
    a.queryCoverage !== null &&
    a.queryCoverage < MIN_QUERY_COVERAGE;
  return out.sort((a, b) => {
    if (!!a.blockedBy !== !!b.blockedBy) return a.blockedBy ? 1 : -1;
    if (navHeavy(a) !== navHeavy(b)) return navHeavy(a) ? 1 : -1;
    if (noQuery(a) !== noQuery(b)) return noQuery(a) ? 1 : -1;
    if (a.weakEvidence !== b.weakEvidence) return a.weakEvidence ? 1 : -1;
    return (b.impressions28 ?? 0) - (a.impressions28 ?? 0);
  });
}

/**
 * 枠に分ける。
 * ★リライトと新規で別の枠を持つ。混ぜると新規が永久に着手されない。
 * ★内部リンク・Threads は枠外（記事1本ぶんの工数がかからない）。
 */
export function splitByQuota(rows: ProposedAction[]): {
  rewrite: ProposedAction[];
  newArticle: ProposedAction[];
  light: ProposedAction[];
  restRewrite: ProposedAction[];
  restNew: ProposedAction[];
} {
  const rewriteAll = rows.filter((a) => isArticleWork(a.type) && !isNewArticle(a.type));
  const newAll = rows.filter((a) => isNewArticle(a.type));
  return {
    rewrite: rewriteAll.slice(0, MONTHLY_QUOTA.rewrite),
    newArticle: newAll.slice(0, MONTHLY_QUOTA.newArticle),
    // ★枠外。軽作業なので記事の枠を消費させない
    light: rows.filter((a) => !isArticleWork(a.type)),
    restRewrite: rewriteAll.slice(MONTHLY_QUOTA.rewrite),
    restNew: newAll.slice(MONTHLY_QUOTA.newArticle),
  };
}

export type ActionStats = {
  proposed: number;
  approved: number;
  rejected: number;
  done: number;
};

export async function getActionStats(): Promise<ActionStats> {
  const grouped = await prisma.action.groupBy({ by: ["state"], _count: { _all: true } });
  const by = new Map(grouped.map((g) => [g.state, g._count._all]));
  return {
    proposed: (by.get("proposed") ?? 0) + (by.get("awaiting_approval") ?? 0),
    approved: by.get("approved") ?? 0,
    rejected: by.get("rejected") ?? 0,
    done: by.get("done") ?? 0,
  };
}
