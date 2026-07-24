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
 * ネタを段5に載せる。
 *
 * ★2つの行き先がある（2026-07-24・U87）
 *   新規記事 … その話題を扱う記事がまだ無い
 *   加筆     … 既に記事がある。**新規で書くと自社どうしが競合する**
 *
 *   実測（2026-07-24）で、未対応35件を話題に束ねると33話題あり、
 *   そのうち **11話題は既に記事があった**（少額減価償却は6本、決算賞与は ART-080）。
 *   それまで行き先が「新規記事」しか無く、画面で警告を出しても
 *   **正しい方の受け皿が存在しなかった**。同じ日に「即時償却」で12記事が
 *   競合しているのを見ており、ネタ画面がその再生産を助長する構造だった。
 *
 * ★ここでは「書く」ことまではしない。承認は人が押す（§12.3）。
 */
export async function adoptIdea(
  ideaId: string,
  /** 加筆先の記事。指定すると new_article ではなく rewrite として起票する */
  targetExternalId?: string,
): Promise<Result> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;

  const idea = await prisma.idea.findUnique({ where: { id: ideaId } });
  if (!idea) return { ok: false, error: "ネタが見つかりません" };
  if (idea.state !== "new") {
    return { ok: false, error: `この状態では記事化できません（${idea.state}）` };
  }

  // 加筆先が指定されていれば実在を確認する（★存在しないIDで起票させない）
  let target: { id: string; externalId: string; title: string } | null = null;
  if (targetExternalId) {
    target = await prisma.contentItem.findFirst({
      where: { externalId: targetExternalId },
      select: { id: true, externalId: true, title: true },
    });
    if (!target) return { ok: false, error: `記事 ${targetExternalId} が見つかりません` };
  }

  const actionId = `act_idea_${idea.id}`;
  const exists = await prisma.action.findUnique({
    where: { id: actionId },
    select: { id: true },
  });

  // ★加筆は rewrite。新規記事とは工数も判定期間も違うので型を分ける
  const type = target ? "rewrite" : "new_article";
  if (!exists) {
    await prisma.action.create({
      data: {
        id: actionId,
        businessId: idea.businessId,
        type,
        title: target
          ? `[ネタ採用・加筆] ${target.externalId} に「${idea.title}」を足す`
          : `[ネタ採用] ${idea.title}`,
        rationale:
          `${idea.body ?? ""}` +
          (target
            ? `／★新規記事ではなく**既存記事への加筆**として起票した。` +
              `この話題は ${target.externalId}「${target.title}」が既に扱っており、` +
              `新規で書くと同じKWで自社どうしが競合する。見出しを足す形で対応する。`
            : `／この話題を扱う記事はまだ無い（新規記事）。`) +
          `／このActionは /ideas で採用したネタから起票された（供給源: ${idea.source}）。`,
        impacts: idea.impacts,
        proposedBy: `idea:${idea.source}`,
        state: "proposed",
        preparedArtifact: {
          ideaId: idea.id,
          source: idea.source,
          sourceRef: idea.sourceRef ?? null,
          contentItemId: target?.id ?? idea.contentItemId,
          contentExternalId: target?.externalId ?? null,
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
    message: target
      ? `${target.externalId} への加筆として「施策・PDCA」に起票しました`
      : "施策・PDCA に「次の一手」として起票しました。承認すると判定期日が予約されます",
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
