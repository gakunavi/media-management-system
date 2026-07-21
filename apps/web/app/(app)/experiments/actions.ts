"use server";

// 段5「次の一手」の承認/却下/差戻し ＋ 立案の実行（設計書 §5.2 / §5.3 / §5.6）
import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@mms/db";
import { auth } from "@/auth";
import { generateProposals, JUDGE_DAYS } from "@/lib/operator";

const DAY = 86400000;

type Result = { ok: true; message: string } | { ok: false; error: string };

async function requireOwner(): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const session = await auth();
  if (!session?.user || session.user.role !== "owner") {
    return { ok: false, error: "権限がありません（owner のみ）" };
  }
  return { ok: true, id: session.user.id };
}

/** 立案を実行（§5.1 週次。手動トリガーとしても使える） */
export async function runOperator(): Promise<Result> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  const { created, scanned } = await generateProposals();
  revalidatePath("/experiments");
  revalidatePath("/");
  return {
    ok: true,
    message:
      created > 0
        ? `立案完了: ${created}件を新規起票（候補 ${scanned}件）`
        : `新規の起票はありませんでした（候補 ${scanned}件は既出）`,
  };
}

function readArtifact(a: unknown): { contentItemId: string | null; evaluateDays: number | null } {
  if (a && typeof a === "object") {
    const o = a as Record<string, unknown>;
    return {
      contentItemId: typeof o.contentItemId === "string" ? o.contentItemId : null,
      evaluateDays: typeof o.evaluateDays === "number" ? o.evaluateDays : null,
    };
  }
  return { contentItemId: null, evaluateDays: null };
}

/**
 * 承認（§5.2）: Action を approved にし、Intervention を生成して判定日を予約する。
 *   baseline に適用前28日の実測を記録（§5.3 の netEffect 計算の起点）。
 */
export async function approveAction(actionId: string): Promise<Result> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;

  const action = await prisma.action.findUnique({ where: { id: actionId } });
  if (!action) return { ok: false, error: "Action が見つかりません" };
  if (action.state !== "proposed" && action.state !== "awaiting_approval") {
    return { ok: false, error: `この状態では承認できません（${action.state}）` };
  }

  const art = readArtifact(action.preparedArtifact);
  const now = new Date();
  const evaluateDays = art.evaluateDays ?? JUDGE_DAYS[action.type] ?? 28;
  const evaluateAt = new Date(now.getTime() + evaluateDays * DAY);

  // 適用前28日の baseline（対象記事の clicks/impressions/position）
  let baseline: Prisma.InputJsonValue = {};
  if (art.contentItemId) {
    const since = new Date(now.getTime() - 28 * DAY);
    const agg = await prisma.contentMetric.groupBy({
      by: ["metric"],
      where: {
        contentItemId: art.contentItemId,
        metric: { in: ["clicks", "impressions", "position"] },
        date: { gte: since },
      },
      _sum: { value: true },
      _avg: { value: true },
    });
    const b: Record<string, number> = {};
    for (const r of agg) {
      b[r.metric] =
        r.metric === "position"
          ? Math.round((r._avg.value ?? 0) * 10) / 10
          : Math.round(r._sum.value ?? 0);
    }
    baseline = { window: "prev28d", ...b };
  }

  await prisma.$transaction([
    prisma.action.update({ where: { id: actionId }, data: { state: "approved" } }),
    prisma.actionEvent.create({
      data: { actionId, event: "approved", actorId: gate.id, at: now },
    }),
    prisma.intervention.create({
      data: {
        actionId,
        contentItemId: art.contentItemId,
        type: action.type,
        appliedAt: now,
        evaluateAt,
        baseline,
        verdict: "pending",
      },
    }),
  ]);

  revalidatePath("/experiments");
  revalidatePath("/");
  return {
    ok: true,
    message: `承認しました。${evaluateDays}日後（${evaluateAt.toLocaleDateString("ja-JP")}）に効果を自動判定します`,
  };
}

/**
 * 却下（§5.6）: 却下理由を ActionEvent に残す。これが次回の立案の学習データになる。
 */
export async function rejectAction(actionId: string, reason: string): Promise<Result> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  if (!reason.trim()) return { ok: false, error: "却下理由は必須です（学習データになります）" };

  const action = await prisma.action.findUnique({ where: { id: actionId }, select: { state: true } });
  if (!action) return { ok: false, error: "Action が見つかりません" };

  await prisma.$transaction([
    prisma.action.update({ where: { id: actionId }, data: { state: "rejected" } }),
    prisma.actionEvent.create({
      data: { actionId, event: "rejected", reason: reason.trim(), actorId: gate.id, at: new Date() },
    }),
  ]);

  revalidatePath("/experiments");
  revalidatePath("/");
  return { ok: true, message: "却下しました。理由は次回の立案に反映されます（§5.6）" };
}
