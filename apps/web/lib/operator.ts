// operator の立案ロジック（設計書 §5.2 / §7.5.2 / §13.3 / §3.5.2）
//
// ★システムの頭脳。既存の実測データから「次の一手（Action）」を自動起票する。
//   §9.4.2 の注意に従い、AIが1本ずつ判定するのではなく **ルール＋一括処理** で作る。
//   起票された Action は段5に並び、人が承認/却下する（責任は人に残す・§12.3）。
import { prisma, type Prisma } from "@mms/db";
import { decodeEntities } from "./content";

const DAY = 86400000;

/** 打ち手タイプごとの判定期間（日）。docs/GLOSSARY.md §5.1 */
export const JUDGE_DAYS: Record<string, number> = {
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
  contentItemId: string;
  contentExternalId: string;
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
  ];

  let created = 0;
  for (const p of proposals) {
    const id = `act_op_${p.ruleKey}_${p.contentExternalId}`;
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
    } else if (pos <= 10 && ctr < 0.01 && clicks <= 3) {
      // Rule A: CTR異常（見えているのに押されない）
      out.push({
        ruleKey: "ctr",
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
