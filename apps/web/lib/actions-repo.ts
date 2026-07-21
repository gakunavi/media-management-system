// 段5「次の一手」の取得（設計書 §4.1 段5・§5.2）
import { prisma } from "@mms/db";

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
};

function readArtifact(a: unknown): { contentExternalId: string | null; evaluateDays: number | null } {
  if (a && typeof a === "object") {
    const o = a as Record<string, unknown>;
    return {
      contentExternalId: typeof o.contentExternalId === "string" ? o.contentExternalId : null,
      evaluateDays: typeof o.evaluateDays === "number" ? o.evaluateDays : null,
    };
  }
  return { contentExternalId: null, evaluateDays: null };
}

/** 承認待ち（proposed / awaiting_approval）の Action を impacts の多い順に */
export async function getProposedActions(limit = 50): Promise<ProposedAction[]> {
  const rows = await prisma.action.findMany({
    where: { state: { in: ["proposed", "awaiting_approval"] } },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows
    .map((r) => {
      const art = readArtifact(r.preparedArtifact);
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
      };
    })
    .sort((a, b) => b.impacts.length - a.impacts.length);
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
