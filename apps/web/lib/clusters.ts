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
