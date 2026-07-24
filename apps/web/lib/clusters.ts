// 内部リンク構造の分析（設計書 §4.2 /clusters・§3.5.2）
//
// ★§3.5.2「トピッククラスタの本質は数ではなくリンク構造」。
//   クラスタ割当（P4.5/P4.9 の enrichment 待ち）が済むまでツリーは描けないが、
//   移行済みの内部リンク599本から「ハブ構造・弱いピラー・孤児」は今すぐ検出できる。
import { prisma } from "@mms/db";
import { decodeEntities } from "./content";

export type LinkStats = {
  articles: number;
  totalLinks: number;
  pillars: number;
  orphans: number;
  byType: { type: string; count: number }[];
};

export type HubRow = {
  id: string;
  externalId: string;
  title: string;
  isPillar: boolean;
  incoming: number; // 被リンク（権威の集まり具合）
  outgoing: number; // 発リンク
  /** 構造上の注意（§3.5.2） */
  flag: "weak_pillar" | "hub_candidate" | null;
};

const LINK_TYPE_LABEL: Record<string, string> = {
  cluster_to_pillar: "クラスター→ピラー",
  pillar_to_cluster: "ピラー→クラスター",
  cluster_to_cluster: "クラスター↔クラスター",
  cross_pillar: "ピラー↔ピラー",
};

export function linkTypeLabel(t: string): string {
  return LINK_TYPE_LABEL[t] ?? t;
}

export async function getLinkAnalysis(): Promise<{
  stats: LinkStats;
  hubs: HubRow[];
}> {
  const [articles, links, byTypeRaw, incomingRaw, outgoingRaw] = await Promise.all([
    prisma.contentItem.findMany({
      where: { type: "article" },
      select: { id: true, externalId: true, title: true, isPillar: true },
    }),
    prisma.internalLink.count(),
    prisma.internalLink.groupBy({ by: ["linkType"], _count: { _all: true } }),
    prisma.internalLink.groupBy({ by: ["dstContentId"], _count: { _all: true } }),
    prisma.internalLink.groupBy({ by: ["srcContentId"], _count: { _all: true } }),
  ]);

  const incomingBy = new Map(incomingRaw.map((r) => [r.dstContentId, r._count._all]));
  const outgoingBy = new Map(outgoingRaw.map((r) => [r.srcContentId, r._count._all]));

  // 被リンク中央値（弱いピラー判定の基準に使う）
  const incomingVals = articles
    .map((a) => incomingBy.get(a.id) ?? 0)
    .filter((v) => v > 0)
    .sort((x, y) => x - y);
  const median =
    incomingVals.length > 0 ? incomingVals[Math.floor(incomingVals.length / 2)] : 0;

  let orphans = 0;
  const hubs: HubRow[] = articles.map((a) => {
    const inc = incomingBy.get(a.id) ?? 0;
    const out = outgoingBy.get(a.id) ?? 0;
    if (inc === 0 && out === 0) orphans += 1;
    // §3.5.2: 宣言ピラーなのに被リンクが中央値未満＝権威が集約されていない弱いピラー
    // 　　　　 非ピラーなのに被リンクが多い＝実質ハブ（ピラー候補）
    let flag: HubRow["flag"] = null;
    if (a.isPillar && inc < median) flag = "weak_pillar";
    else if (!a.isPillar && inc >= median * 2 && inc >= 10) flag = "hub_candidate";
    return {
      id: a.id,
      externalId: a.externalId,
      title: decodeEntities(a.title),
      isPillar: a.isPillar,
      incoming: inc,
      outgoing: out,
      flag,
    };
  });

  hubs.sort((a, b) => b.incoming - a.incoming);

  return {
    stats: {
      articles: articles.length,
      totalLinks: links,
      pillars: articles.filter((a) => a.isPillar).length,
      orphans,
      byType: byTypeRaw
        .map((r) => ({ type: r.linkType, count: r._count._all }))
        .sort((a, b) => b.count - a.count),
    },
    hubs,
  };
}

// ── トピッククラスタ（2026-07-23 追加）────────────────────────
//
// ★これまで「クラスタ割当が済むまでツリーは描けない」としていたが、
//   割当は**メディア事業部側で管理されていた**（MMSへ移行されていなかっただけ）。
//   cowork から台帳を受け取り 17クラスタ・101本を投入した。
//
// ★見たいのは「数」ではなく「ハブが機能しているか」（§3.5.2）。
//   ・ピラーが指定されていない → 評価の受け皿が無い（state=pillar_missing）
//   ・ピラーよりクリックを集めている子がいる → ハブが実態と合っていない
//   どちらも「記事を増やす」では直らない。構造の問題として出す。

export type ClusterRow = {
  id: string;
  name: string;
  slug: string;
  state: string;
  pillarType: string;
  articles: number;
  clicks: number;
  impressions: number;
  leads: number;
  pillar: { externalId: string; title: string; clicks: number } | null;
  /** クリック最多の記事。ピラーと違うならハブが実態と合っていない */
  top: { externalId: string; title: string; clicks: number } | null;
  /** クラスタ内で被リンクが集まっている先（ピラーに集まっているのが健全） */
  pillarIncoming: number | null;
  /** 由来・判断の根拠 */
  note: string | null;
  /**
   * 子記事のうち、ピラーへのリンクが2本未満のもの。
   * ★内部リンクの打ち手は1本ごとの効果を測れないので（cowork 2026-07-24）、
   *   **ここが減っていくこと**と**ピラー側の表示・順位**の2つで進捗を見る。
   */
  lackingLinks: number;
  /** 子記事の数（ピラーを除く） */
  children: number;
  /**
   * ピラーが無いのが**設計どおり**か。
   * ★「欠けている」と「置かない」を区別しないと、直す必要の無いものを直そうとする。
   *   横串クラスタはクラスタ横断のため Pillar-Cluster 構造を取らない（cowork 2026-07-23）。
   */
  pillarByDesign: boolean;
};

/** note に記録した「設計上ピラーを置かない」の目印 */
const BY_DESIGN = "ピラーを置かないのが設計";

export const CLUSTER_STATE_LABEL: Record<string, string> = {
  healthy: "正常",
  pillar_missing: "ピラー無し",
  thin: "記事が少ない",
  cannibalized: "カニバリ",
  orphan: "孤立",
};

export const PILLAR_TYPE_LABEL: Record<string, string> = {
  A_standard: "A 通常",
  B_news: "B 時事",
  C_risk: "C リスク中立",
};

export async function getClusters(): Promise<ClusterRow[]> {
  const [clusters, incomingRaw, allLinks] = await Promise.all([
    prisma.topicCluster.findMany({
      select: {
        id: true,
        name: true,
        slug: true,
        state: true,
        pillarType: true,
        pillarContentId: true,
        note: true,
        members: {
          select: {
            role: true,
            contentItem: {
              select: {
                id: true,
                externalId: true,
                title: true,
                _count: { select: { firstTouchLeads: true } },
              },
            },
          },
        },
      },
    }),
    prisma.internalLink.groupBy({ by: ["dstContentId"], _count: { _all: true } }),
    prisma.internalLink.findMany({ select: { srcContentId: true, dstContentId: true } }),
  ]);
  // 子 → ピラー のリンク本数
  const pairCount = new Map<string, number>();
  for (const l of allLinks) {
    const k = `${l.srcContentId}>${l.dstContentId}`;
    pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
  }

  const memberIds = clusters.flatMap((c) => c.members.map((m) => m.contentItem.id));
  // ★クリックは最新の集計期間（ContentQuery）から取る。
  //   ContentMetric の日次を期間なしで合算すると、古い記事ほど有利になる。
  const latest = await prisma.contentQuery.findFirst({
    orderBy: { periodEnd: "desc" },
    select: { periodStart: true, periodEnd: true },
  });
  const perArticle = latest
    ? await prisma.contentQuery.groupBy({
        by: ["contentItemId"],
        where: {
          contentItemId: { in: memberIds },
          periodStart: latest.periodStart,
          periodEnd: latest.periodEnd,
        },
        _sum: { clicks: true, impressions: true },
      })
    : [];
  const clicksBy = new Map(perArticle.map((r) => [r.contentItemId, r._sum.clicks ?? 0]));
  const imprBy = new Map(perArticle.map((r) => [r.contentItemId, r._sum.impressions ?? 0]));
  const incomingBy = new Map(incomingRaw.map((r) => [r.dstContentId, r._count._all]));

  const rows: ClusterRow[] = clusters.map((c) => {
    const members = c.members.map((m) => ({
      id: m.contentItem.id,
      externalId: m.contentItem.externalId,
      title: decodeEntities(m.contentItem.title),
      clicks: clicksBy.get(m.contentItem.id) ?? 0,
      leads: m.contentItem._count.firstTouchLeads,
    }));
    const sorted = [...members].sort((a, b) => b.clicks - a.clicks);
    const pillarMember = members.find((m) => m.id === c.pillarContentId) ?? null;
    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      state: c.state,
      pillarType: c.pillarType,
      articles: members.length,
      clicks: members.reduce((s, m) => s + m.clicks, 0),
      impressions: members.reduce((s, m) => s + (imprBy.get(m.id) ?? 0), 0),
      leads: members.reduce((s, m) => s + m.leads, 0),
      pillar: pillarMember
        ? { externalId: pillarMember.externalId, title: pillarMember.title, clicks: pillarMember.clicks }
        : null,
      top: sorted[0] ?? null,
      pillarIncoming: c.pillarContentId ? (incomingBy.get(c.pillarContentId) ?? 0) : null,
      note: c.note,
      pillarByDesign: (c.note ?? "").includes(BY_DESIGN),
      children: members.filter((m) => m.id !== c.pillarContentId).length,
      lackingLinks: c.pillarContentId
        ? members.filter(
            (m) =>
              m.id !== c.pillarContentId &&
              (pairCount.get(`${m.id}>${c.pillarContentId}`) ?? 0) < 2,
          ).length
        : 0,
    };
  });

  // 記事数の多い順（＝影響の大きい順）
  return rows.sort((a, b) => b.articles - a.articles);
}
