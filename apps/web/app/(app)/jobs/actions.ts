"use server";

// ジョブの手動実行・有効切替（設計書 §4.2 /jobs）
//
// ★手動実行も worker と同じロジック（TS側の関数）を呼び、JobRun に必ず記録する。
//   「手で回したら履歴が残らない」を作らない（§12.4 の反省）。
import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@mms/db";
import { auth } from "@/auth";
import { generateProposals } from "@/lib/operator";
import { evaluateDueInterventions } from "@/lib/evaluate";

type Result = { ok: true; message: string } | { ok: false; error: string };

async function requireOwner(): Promise<Result | null> {
  const session = await auth();
  if (!session?.user || session.user.role !== "owner") {
    return { ok: false, error: "権限がありません（owner のみ）" };
  }
  return null;
}

/** path → 実行する関数。worker の kind="http" と同じ入口を共有する */
const HTTP_TASKS: Record<string, () => Promise<Record<string, unknown>>> = {
  "/api/jobs/propose": async () => ({ ...(await generateProposals()) }),
  "/api/jobs/evaluate": async () => ({ ...(await evaluateDueInterventions()) }),
};

export async function runJobNow(jobId: string): Promise<Result> {
  const gate = await requireOwner();
  if (gate) return gate;

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return { ok: false, error: "ジョブが見つかりません" };

  const cfg = (job.config ?? {}) as Record<string, unknown>;
  const path = typeof cfg.path === "string" ? cfg.path : null;
  const task = job.kind === "http" && path ? HTTP_TASKS[path] : undefined;
  if (!task) {
    return {
      ok: false,
      error: `この画面から手動実行できるのは内部ジョブのみです（kind=${job.kind}）。legacy スクリプトは worker がスケジュールで実行します`,
    };
  }

  const startedAt = new Date();
  const run = await prisma.jobRun.create({
    data: { jobId: job.id, startedAt, status: "running" },
  });

  try {
    const result = await task();
    const finishedAt = new Date();
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        finishedAt,
        status: "success",
        log: JSON.stringify({ manual: true, ...result }),
        metrics: {
          elapsedSeconds: (finishedAt.getTime() - startedAt.getTime()) / 1000,
        } as Prisma.InputJsonValue,
      },
    });
    revalidatePath("/jobs");
    revalidatePath("/");
    return { ok: true, message: `実行しました: ${JSON.stringify(result)}` };
  } catch (e) {
    const finishedAt = new Date();
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    await prisma.jobRun.update({
      where: { id: run.id },
      data: {
        finishedAt,
        status: "failed",
        log: msg,
        metrics: {
          elapsedSeconds: (finishedAt.getTime() - startedAt.getTime()) / 1000,
        } as Prisma.InputJsonValue,
      },
    });
    revalidatePath("/jobs");
    // ★失敗は握り潰さず JobRun(failed) に残す（段7に赤で出る）
    return { ok: false, error: `失敗: ${msg}` };
  }
}

export async function toggleJob(jobId: string, enabled: boolean): Promise<Result> {
  const gate = await requireOwner();
  if (gate) return gate;
  await prisma.job.update({ where: { id: jobId }, data: { enabled } });
  revalidatePath("/jobs");
  revalidatePath("/");
  return { ok: true, message: enabled ? "有効にしました" : "停止しました" };
}
