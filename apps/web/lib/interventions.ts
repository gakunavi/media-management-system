// 実行済みの打ち手＝Intervention の一覧（設計書 §5.3 Check）
import { prisma } from "@mms/db";

export type InterventionRow = {
  id: string;
  type: string;
  appliedAt: Date;
  evaluateAt: Date;
  verdict: string;
  contentExternalId: string | null;
  /** 判定期日を過ぎているか（自動判定ジョブ未実装のため手掛かりに） */
  due: boolean;
};

export async function getInterventions(): Promise<InterventionRow[]> {
  const rows = await prisma.intervention.findMany({
    orderBy: { appliedAt: "desc" },
    include: { contentItem: { select: { externalId: true } } },
  });
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    appliedAt: r.appliedAt,
    evaluateAt: r.evaluateAt,
    verdict: r.verdict,
    contentExternalId: r.contentItem?.externalId ?? null,
    due: r.evaluateAt.getTime() <= now,
  }));
}
