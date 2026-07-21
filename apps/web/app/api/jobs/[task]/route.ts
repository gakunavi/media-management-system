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
import { getJobHealth } from "@/lib/dashboard";
import { notify } from "@/lib/notify";
import { evaluateDueInterventions } from "@/lib/evaluate";
import { safeEqual } from "@/lib/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TASKS = ["propose", "evaluate", "ideas", "alerts"] as const;
type Task = (typeof TASKS)[number];

function isTask(v: string): v is Task {
  return (TASKS as readonly string[]).includes(v);
}

/**
 * 段7の異常だけを通知する。異常が無ければ何も送らない。
 * ★毎日「異常なし」を送ると通知が無視されるようになり、本当の異常を見逃す。
 */
async function sendHealthAlerts(): Promise<{ sent: number; alerts: string[] }> {
  const health = await getJobHealth();
  const alerts: string[] = [];

  if (health.gsc.alert === "red") {
    alerts.push(`GSC 日次が ${health.gsc.gapDays}日欠測（最終 ${health.gsc.latestDate?.toLocaleDateString("ja-JP")}）`);
  }
  if (health.threads.alert === "red" || health.threads.alert === "warn") {
    // ★「何日止まった」だけでなく残数も出す。止まる前に打てる手が変わる
    alerts.push(`Threads 配信: ${health.threads.reason}`);
  }
  for (const t of health.tools) alerts.push(t.message);
  for (const j of health.jobs) {
    if (j.lastStatus === "failed") alerts.push(`ジョブ失敗: ${j.name}`);
  }

  if (alerts.length === 0) return { sent: 0, alerts: [] };

  await notify({
    event: "health.alert",
    title: `⚠️ MMS 運用アラート（${alerts.length}件）`,
    body: alerts.map((a) => `・${a}`).join("\n"),
    url: process.env.MMS_PUBLIC_URL ?? "http://localhost:3000",
  });
  return { sent: alerts.length, alerts };
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
    if (task === "alerts") {
      // 段7の警告を通知する（§5.4「石井さんへ即通知」）。
      // ★画面に出すだけでは、画面を開くまで誰も気づかない。実際に
      //   「投稿が2日止まっている」「残高が枯渇しかけ」を誰も知らなかった。
      const r = await sendHealthAlerts();
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
