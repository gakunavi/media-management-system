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
  if (latest && ids.length) {
    const qs = await prisma.contentQuery.findMany({
      where: {
        contentItemId: { in: ids },
        periodStart: latest.periodStart,
        periodEnd: latest.periodEnd,
      },
      select: { contentItemId: true, query: true, impressions: true },
    });
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
      // ★表示が取れていないものは「根拠が弱い」。null（信号なし）も同じ扱い
      weakEvidence: impressions28 === null || impressions28 < MIN_IMPRESSIONS,
    };
  });

  // ① 判定待ちで重なるものは最後 ② 指名検索が主なものは後ろ
  // ③ 根拠が弱いものは後ろ ④ 表示の多い順
  const navHeavy = (a: (typeof out)[number]) =>
    a.navigationalShare !== null && a.navigationalShare >= NAV_SHARE_THRESHOLD;
  return out.sort((a, b) => {
    if (!!a.blockedBy !== !!b.blockedBy) return a.blockedBy ? 1 : -1;
    if (navHeavy(a) !== navHeavy(b)) return navHeavy(a) ? 1 : -1;
    if (a.weakEvidence !== b.weakEvidence) return a.weakEvidence ? 1 : -1;
    return (b.impressions28 ?? 0) - (a.impressions28 ?? 0);
  });
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
