"use server";

// 投稿キュー補充の承認・却下（設計書 §12.3）
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { approveDrafts, rejectDraft } from "@/lib/threads-queue";

type Result = { ok: true; message: string } | { ok: false; error: string };

async function requireOwner(): Promise<Result | null> {
  const session = await auth();
  if (!session?.user || session.user.role !== "owner") {
    return { ok: false, error: "権限がありません（owner のみ）" };
  }
  return null;
}

/** 選んだ下書きを公開待ち（pending）にする */
export async function approveQueueDrafts(rowIndexes: number[]): Promise<Result> {
  const gate = await requireOwner();
  if (gate) return gate;

  const rows = rowIndexes.filter((n) => Number.isInteger(n) && n > 1);
  if (rows.length === 0) return { ok: false, error: "承認する下書きを選んでください" };

  try {
    const { approved } = await approveDrafts(rows);
    revalidatePath("/threads");
    revalidatePath("/");
    return { ok: true, message: `${approved}件を公開待ちにしました` };
  } catch (e) {
    // ★何件目で失敗したかは GAS 側の行状態を見れば分かる。途中まで承認済みの
    //   可能性があるので「全部失敗した」とは書かない
    return {
      ok: false,
      error: `承認を完了できませんでした（途中まで反映されている場合があります）: ${
        e instanceof Error ? e.message : String(e)
      }`,
    };
  }
}

/** 下書きを却下する。理由は必須（次の立案の材料になる・§5.6） */
export async function rejectQueueDraft(rowIndex: number, reason: string): Promise<Result> {
  const gate = await requireOwner();
  if (gate) return gate;

  try {
    await rejectDraft(rowIndex, reason);
    revalidatePath("/threads");
    return { ok: true, message: "却下しました" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
