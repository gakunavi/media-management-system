"use server";

// ネタの採用/見送り（設計書 §4.2 /ideas・§5.2）
//
// ★ネタは「作って終わり」では意味がない。採用したら既存のPDCAループ
//   （Action → 承認 → Intervention → 判定 → Learning）に載せる。
//   ここが繋がっていないと、ネタが溜まるだけで着手されない。
//
// ★見送り理由を残すのは §5.6 と同じ考え方。「なぜ採らなかったか」が
//   次の供給ロジックを直す材料になる。理由なしの却下は学習を生まない。
import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@mms/db";
import { currentUser } from "@/lib/session";
import { JUDGE_DAYS } from "@/lib/operator";

const DAY = 86400000;

type Result = { ok: true; message: string } | { ok: false; error: string };

async function requireOwner(): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // ★auth() を直接使わない。localhost の自動ログインでは Cookie 名が違い、
  //   auth() が常に null を返して owner 限定の操作が全部落ちる（lib/session.ts）
  const user = await currentUser();
  if (user?.role !== "owner") {
    return { ok: false, error: "権限がありません（owner のみ）" };
  }
  return { ok: true, id: user.id };
}

/**
 * 記事化する: Action(new_article) を起票して段5に載せる。
 * ★ここでは「書く」ことまではしない。承認は人が押す（§12.3）。
 */
export async function adoptIdea(ideaId: string): Promise<Result> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;

  const idea = await prisma.idea.findUnique({ where: { id: ideaId } });
  if (!idea) return { ok: false, error: "ネタが見つかりません" };
  if (idea.state !== "new") {
    return { ok: false, error: `この状態では記事化できません（${idea.state}）` };
  }

  const actionId = `act_idea_${idea.id}`;
  const exists = await prisma.action.findUnique({
    where: { id: actionId },
    select: { id: true },
  });

  const type = "new_article";
  if (!exists) {
    await prisma.action.create({
      data: {
        id: actionId,
        businessId: idea.businessId,
        type,
        title: `[ネタ採用] ${idea.title}`,
        rationale:
          `${idea.body ?? ""}` +
          `／このActionは /ideas で採用したネタから起票された（供給源: ${idea.source}）。`,
        impacts: idea.impacts,
        proposedBy: `idea:${idea.source}`,
        state: "proposed",
        preparedArtifact: {
          ideaId: idea.id,
          source: idea.source,
          sourceRef: idea.sourceRef ?? null,
          contentItemId: idea.contentItemId,
          evaluateDays: JUDGE_DAYS[type] ?? 56,
        } as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + 14 * DAY),
      },
    });
  }

  await prisma.idea.update({
    where: { id: ideaId },
    data: {
      state: "adopted",
      // ★どのActionになったかを追えるようにする（Idea に actionId 列が無いため）
      sourceRef: {
        ...(typeof idea.sourceRef === "object" && idea.sourceRef !== null
          ? (idea.sourceRef as Record<string, unknown>)
          : {}),
        actionId,
      } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/ideas");
  revalidatePath("/experiments");
  return {
    ok: true,
    message: "施策・PDCA に「次の一手」として起票しました。承認すると判定期日が予約されます",
  };
}

/** 見送る: 理由を残す。理由は次回の供給ロジックを直す材料になる（§5.6） */
export async function dismissIdea(ideaId: string, reason: string): Promise<Result> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  if (!reason.trim()) {
    return { ok: false, error: "見送り理由は必須です（次の供給を直す材料になります）" };
  }

  const idea = await prisma.idea.findUnique({ where: { id: ideaId } });
  if (!idea) return { ok: false, error: "ネタが見つかりません" };

  await prisma.idea.update({
    where: { id: ideaId },
    data: {
      state: "dismissed",
      sourceRef: {
        ...(typeof idea.sourceRef === "object" && idea.sourceRef !== null
          ? (idea.sourceRef as Record<string, unknown>)
          : {}),
        dismissedReason: reason.trim(),
        dismissedAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/ideas");
  return { ok: true, message: "見送りました。理由は次回の供給の見直しに使います" };
}
