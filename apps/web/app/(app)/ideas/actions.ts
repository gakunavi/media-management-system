"use server";

// ネタ収集の手動実行（設計書 §4.2 /ideas）。通常は週次ジョブが回す。
import { revalidatePath } from "next/cache";
import { isOwner } from "@/lib/session";
import { generateIdeas } from "@/lib/ideas";

type Result = { ok: true; message: string } | { ok: false; error: string };

export async function runIdeaCollection(): Promise<Result> {
  // ★auth() を直接使わない。localhost の自動ログインでは Cookie 名が違い、
  //   auth() が常に null を返して owner 限定の操作が全部落ちる（lib/session.ts）
  if (!(await isOwner())) {
    return { ok: false, error: "権限がありません（owner のみ）" };
  }
  const { created, scanned } = await generateIdeas();
  revalidatePath("/ideas");
  return {
    ok: true,
    message:
      created > 0
        ? `${created}件を新規起票（候補 ${scanned}件）`
        : `新規はありません（候補 ${scanned}件は既出）`,
  };
}
