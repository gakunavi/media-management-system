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
import { getJobHealth, getMetricFreshness } from "@/lib/dashboard";
import { notify } from "@/lib/notify";
import { evaluateDueInterventions } from "@/lib/evaluate";
import { safeEqual } from "@/lib/crypto";
import { refillQueue } from "@/lib/threads-queue";
import { runUptimeChecks } from "@/lib/uptime";
import { aggregateTelemetryVolume, proposeStopIfSpiking } from "@/lib/telemetry-volume";
import { collectPageExperience } from "@/lib/page-experience";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TASKS = [
  "propose",
  "evaluate",
  "ideas",
  "alerts",
  "queue-refill",
  "uptime",
  "telemetry",
  "page-experience",
] as const;
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
  if (health.insights.alert === "red" || health.insights.alert === "warn") {
    // ★投稿が出ていることと、その結果が測れていることは別の障害
    alerts.push(`Threads 計測: ${health.insights.reason}`);
  }
  // ★満杯になると Postgres がチェックポイントを書けず全部が同時に止まる。
  //   ジョブの成否では気づけない（ジョブ自体が動けないので記録も残らない）。
  //   2026-07-23 に実際に起き、「画面が開かない」で初めて気づいた
  if (health.storage.alert === "red" || health.storage.alert === "warn") {
    alerts.push(`ストレージ: ${health.storage.reason}`);
  }
  // ★ジョブが成功していても、書くはずのデータが入っていないことがある。
  //   実際 pv は全ジョブ緑のまま9日間止まっていた。
  const stale = (await getMetricFreshness()).filter((m) => m.alert !== "ok");
  for (const m of stale) {
    alerts.push(
      `指標 ${m.metric} が ${m.ageDays}日更新なし（通常${m.intervalDays}日間隔・最終 ${m.lastDate.toLocaleDateString("ja-JP")}）`,
    );
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
    if (task === "queue-refill") {
      // ★承認を挟まずに draft を公開待ちへ上げる。止めないことを優先する。
      //   YMYL に触れた原稿だけは error に落として残す（捨てない）。
      const r = await refillQueue();
      if (r.held > 0 || r.pendingAfter <= 15) {
        await notify({
          event: "threads.queue",
          title:
            r.pendingAfter <= 15
              ? `⚠️ Threads キュー残り${r.pendingAfter}本（補充が追いつきません）`
              : `Threads 自動補充: ${r.held}本を保留しました`,
          body: [
            `公開待ちに追加: ${r.promoted}本`,
            `YMYLで保留: ${r.held}本（シートの error 行を確認）`,
            `残り draft: ${r.draftsLeft}本`,
          ].join("\n"),
        });
      }
      return NextResponse.json({ ok: true, task, ...r });
    }
    if (task === "page-experience") {
      // §3.6.4 ページ体験（Core Web Vitals）。★全記事を毎回測らず、
      //   「最後に測った日が古い順」に少しずつ回して全体を覆う。
      //   ラボ値（psi）と実ユーザー（crux）を別々に保存する（§4-106）
      const r = await collectPageExperience();
      return NextResponse.json({ ok: true, task, ...r });
    }
    if (task === "telemetry") {
      // §3.10.4 発火回数の監視。1時間ぶんを確定させ、急増していれば
      // 「受信を止める」提案を段5に出す（★自動では止めない。押すのは人・§15）
      const agg = await aggregateTelemetryVolume();
      const spike = await proposeStopIfSpiking();
      if (spike.proposed) {
        await notify({
          event: "telemetry.spike",
          title: "🚨 計測タグの発火が急増しています",
          body: [
            spike.reason,
            "",
            "段5に「計測タグの受信を止める」を出しました。",
            "★過去に自前のPV計測が暴走してサイトが重くなる事故を起こしています。",
          ].join("\n"),
          url: process.env.MMS_PUBLIC_URL ?? "http://localhost:3000",
        });
      }
      return NextResponse.json({ ok: true, task, ...agg, ...spike });
    }
    if (task === "uptime") {
      // §3.9.3 死活監視。5分間隔で叩き、連続3回失敗で即通知する。
      // ★通知を web 側に置くのは、worker から notify を呼ぶ経路が無いため。
      //   Python 側に通知を再実装すると二重実装になり必ず乖離する。
      const r = await runUptimeChecks();
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
