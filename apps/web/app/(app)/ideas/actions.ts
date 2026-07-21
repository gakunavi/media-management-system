"use server";

// ネタ収集の手動実行（設計書 §4.2 /ideas）。通常は週次ジョブが回す。
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { generateIdeas } from "@/lib/ideas";

type Result = { ok: true; message: string } | { ok: false; error: string };

export async function runIdeaCollection(): Promise<Result> {
  const session = await auth();
  if (!session?.user || session.user.role !== "owner") {
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
