"use server";

// 代理店リードの記録・段階更新（設計書 §3-6・P5.6）
//
// ★Threads に DM 取得の API が無いため手入力。自動化できない部分は
//   「入力させない」のではなく「入力しやすくする」で埋める。
import { revalidatePath } from "next/cache";
import { prisma } from "@mms/db";
import { isOwner } from "@/lib/session";
import { STAGE_ORDER } from "@/lib/agency";

type Result = { ok: true; message: string } | { ok: false; error: string };

const ALL_STAGES = [...STAGE_ORDER, "rejected"] as const;

async function requireOwner(): Promise<Result | null> {
  // ★auth() を直接使わない。localhost の自動ログインでは Cookie 名が違い、
  //   auth() が常に null を返して owner 限定の操作が全部落ちる（lib/session.ts）
  if (!(await isOwner())) {
    return { ok: false, error: "権限がありません（owner のみ）" };
  }
  return null;
}

/** DM受信を記録する。sourcePostId（THR-xxx）を入れると angle 別の効果が測れる */
export async function addAgencyLead(input: {
  threadsUserId: string;
  sourcePostId?: string;
  receivedAt?: string;
}): Promise<Result> {
  const gate = await requireOwner();
  if (gate) return gate;

  const handle = input.threadsUserId.trim().replace(/^@/, "");
  if (!handle) return { ok: false, error: "Threadsのユーザー名は必須です" };

  const src = input.sourcePostId?.trim() || null;
  if (src) {
    // ★存在しない投稿IDを許すと angle 集計が静かに壊れる。入力時に弾く
    const exists = await prisma.contentItem.findFirst({
      where: { externalId: src, type: "post" },
      select: { id: true },
    });
    if (!exists) {
      return { ok: false, error: `投稿ID「${src}」が見つかりません（例: THR-519）` };
    }
  }

  const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
  if (Number.isNaN(receivedAt.getTime())) {
    return { ok: false, error: "受信日時の形式が不正です" };
  }

  const dup = await prisma.agencyLead.findFirst({
    where: { threadsUserId: handle },
    select: { id: true },
  });
  if (dup) return { ok: false, error: `@${handle} は既に登録済みです` };

  await prisma.agencyLead.create({
    data: { threadsUserId: handle, receivedAt, sourcePostId: src, stage: "received" },
  });

  revalidatePath("/threads");
  return { ok: true, message: `@${handle} を登録しました${src ? `（${src} 経由）` : ""}` };
}

/** 段階を更新する。押した記録が歩留まりの母数になる */
export async function setAgencyStage(id: string, stage: string): Promise<Result> {
  const gate = await requireOwner();
  if (gate) return gate;
  if (!(ALL_STAGES as readonly string[]).includes(stage)) {
    return { ok: false, error: `未知の段階: ${stage}` };
  }

  const lead = await prisma.agencyLead.update({
    where: { id },
    data: {
      stage: stage as (typeof ALL_STAGES)[number],
      // §3 forwardedAt: 取次いだ日を残す（歩留まりの時間軸に使う）
      ...(stage === "forwarded" ? { forwardedAt: new Date() } : {}),
    },
    select: { threadsUserId: true },
  });

  revalidatePath("/threads");
  return { ok: true, message: `@${lead.threadsUserId} を「${stage}」に更新しました` };
}
