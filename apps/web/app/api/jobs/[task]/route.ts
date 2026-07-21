// worker から呼ばれる内部ジョブ受口（設計書 §5.1 の日次/週次ループ）
//
// ★TypeScript 側のロジック（立案・判定）を worker から実行するための入口。
//   Python 側に再実装しない（二重実装は必ず乖離する）。
//
// 認証: X-MMS-Job-Secret ヘッダ。未設定なら fail-closed で 503。
//   ★この受口は認証必須なので middleware の公開パスに入れない。
import { NextResponse } from "next/server";
import { generateProposals } from "@/lib/operator";
import { generateIdeas } from "@/lib/ideas";
import { evaluateDueInterventions } from "@/lib/evaluate";
import { safeEqual } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TASKS = ["propose", "evaluate", "ideas"] as const;
type Task = (typeof TASKS)[number];

function isTask(v: string): v is Task {
  return (TASKS as readonly string[]).includes(v);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ task: string }> },
) {
  const secret = process.env.MMS_JOB_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, reason: "MMS_JOB_SECRET が未設定のため実行を拒否しました" },
      { status: 503 },
    );
  }
  const given = req.headers.get("x-mms-job-secret");
  if (!given || !safeEqual(secret, given)) {
    return NextResponse.json({ ok: false, reason: "認証に失敗しました" }, { status: 401 });
  }

  const { task } = await params;
  if (!isTask(task)) {
    return NextResponse.json(
      { ok: false, reason: `未知のタスク: ${task}（対応: ${TASKS.join(", ")}）` },
      { status: 400 },
    );
  }

  try {
    if (task === "propose") {
      const r = await generateProposals();
      return NextResponse.json({ ok: true, task, ...r });
    }
    if (task === "ideas") {
      // §4.2 /ideas「記事ネタの自動供給」。Threads反響・AIO未引用から起票
      const r = await generateIdeas();
      return NextResponse.json({ ok: true, task, ...r });
    }
    const r = await evaluateDueInterventions();
    return NextResponse.json({ ok: true, task, ...r });
  } catch (e) {
    // ★失敗は握り潰さず worker 側で JobRun(failed) に残るよう 500 を返す
    return NextResponse.json(
      { ok: false, task, reason: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
