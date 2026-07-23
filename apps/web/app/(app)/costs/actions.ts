"use server";

// ツール契約の登録・更新・判定（方針は lib/tools.ts のコメント参照）
import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@mms/db";
import { isOwner } from "@/lib/session";

type Result = { ok: true; message: string } | { ok: false; error: string };

async function requireOwner(): Promise<Result | null> {
  // ★auth() を直接使わない。localhost の自動ログインでは Cookie 名が違い、
  //   auth() が常に null を返して owner 限定の操作が全部落ちる（lib/session.ts）
  if (!(await isOwner())) {
    return { ok: false, error: "権限がありません（owner のみ）" };
  }
  return null;
}

function toDate(v?: string): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function upsertTool(input: {
  id?: string;
  name: string;
  vendor?: string;
  plan?: string;
  billingType: string;
  monthlyYen?: string;
  state: string;
  purpose: string;
  expectedOutcome?: string;
  decideBy?: string;
  note?: string;
  vendorKey?: string;
}): Promise<Result> {
  const gate = await requireOwner();
  if (gate) return gate;

  const name = input.name.trim();
  if (!name) return { ok: false, error: "ツール名は必須です" };

  // ★目的を必須にする。空欄のまま増えると「何のために払っているか分からない
  //   ツール一覧」になり、この画面を作った意味が無くなる
  const purpose = input.purpose.trim();
  if (!purpose) return { ok: false, error: "目的は必須です（何のために入れたか）" };

  const business = await prisma.business.findFirst({
    where: { slug: process.env.MMS_DEFAULT_BUSINESS_SLUG ?? "tax-saving-agency" },
    select: { id: true },
  });
  if (!business) return { ok: false, error: "Business がありません" };

  const monthly = input.monthlyYen?.trim() ? Number(input.monthlyYen) : null;
  if (monthly !== null && !Number.isFinite(monthly)) {
    return { ok: false, error: "月額は数値で入力してください" };
  }

  const data = {
    name,
    vendor: input.vendor?.trim() || null,
    plan: input.plan?.trim() || null,
    billingType: input.billingType as Prisma.ToolSubscriptionCreateInput["billingType"],
    monthlyYen: monthly,
    state: input.state as Prisma.ToolSubscriptionCreateInput["state"],
    purpose,
    expectedOutcome: input.expectedOutcome?.trim() || null,
    decideBy: toDate(input.decideBy),
    note: input.note?.trim() || null,
    vendorKey: input.vendorKey?.trim() || null,
  };

  if (input.id) {
    await prisma.toolSubscription.update({ where: { id: input.id }, data });
  } else {
    await prisma.toolSubscription.create({ data: { ...data, businessId: business.id } });
  }

  revalidatePath("/costs");
  revalidatePath("/");
  return { ok: true, message: `「${name}」を保存しました` };
}

/**
 * 継続/停止の判定を記録する。
 * ★根拠を必須にする（§5.6 と同じ考え方）。理由のない判定は次に活きない。
 */
export async function decideTool(
  id: string,
  decision: string,
  nextState: string,
): Promise<Result> {
  const gate = await requireOwner();
  if (gate) return gate;
  if (!decision.trim()) {
    return { ok: false, error: "判定の根拠は必須です（次の判断材料になります）" };
  }

  const t = await prisma.toolSubscription.update({
    where: { id },
    data: {
      decision: decision.trim(),
      decidedAt: new Date(),
      state: nextState as Prisma.ToolSubscriptionCreateInput["state"],
      ...(nextState === "stopped" ? { endedAt: new Date() } : {}),
    },
    select: { name: true },
  });

  revalidatePath("/costs");
  revalidatePath("/");
  return { ok: true, message: `「${t.name}」の判定を記録しました` };
}

/**
 * ツールを削除する。
 *
 * ★実績（月額の推移）が残っているものは削除させない。
 *   消すと推移から過去の月まで消え、「先月は安かった」という嘘の推移になる。
 *   使わなくなったものは **state=stopped**（停止）にする。それが正しい記録。
 * ★誤登録をすぐ消せる道は残す（実績が無いものだけ）。
 */
export async function deleteTool(id: string): Promise<Result> {
  const gate = await requireOwner();
  if (gate) return gate;

  const tool = await prisma.toolSubscription.findUnique({
    where: { id },
    select: { name: true, _count: { select: { costs: true } } },
  });
  if (!tool) return { ok: false, error: "見つかりません" };

  if (tool._count.costs > 0) {
    return {
      ok: false,
      error:
        `「${tool.name}」は月額の記録が${tool._count.costs}件あるため削除できません。` +
        "使わなくなったなら「停止」にしてください（削除すると過去の推移まで消え、実際より安かったことになります）",
    };
  }

  await prisma.toolSubscription.delete({ where: { id } });
  revalidatePath("/costs");
  revalidatePath("/");
  return { ok: true, message: `「${tool.name}」を削除しました` };
}
