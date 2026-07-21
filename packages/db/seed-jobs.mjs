// 定期ジョブの登録（設計書 §5.1 の自動運営ループ）
//
//   週次 月 09:00 … 立案（段5「次の一手」を起票）
//   日次 08:00   … 判定期日を迎えた Intervention を自動判定 → Learning 生成
//
// ★§1.1 の成功指標③「石井さんのコマンド実行回数 0回」に直結する。
// ★worker は「呼ぶだけ」。ロジックは web 側（TypeScript）にある。
//
// 実行: npm run seed:jobs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// secrets/gsc-service-account.json があるかで GSC ジョブの有効/無効を決める。
// ★鍵が無いまま有効にすると失敗が段7を赤で埋める（services/worker/legacy/README.md N5）
import { existsSync } from "node:fs";
import path from "node:path";
const GSC_KEY = path.resolve(process.cwd(), "../../secrets/gsc-service-account.json");
const gscKeyReady = existsSync(GSC_KEY);

// WP 認証が .env にあるかで WP同期ジョブの有効/無効を決める
import { readFileSync } from "node:fs";
let wpReady = false;
let threadsReady = false;
try {
  const envText = readFileSync(path.resolve(process.cwd(), "../../.env"), "utf8");
  wpReady = /^MMS_WP_APP_PASSWORD=.+$/m.test(envText) && /^MMS_WP_USER=.+$/m.test(envText);
  // Threads は GAS Web App から pull する。URL と鍵が揃って初めて有効化する
  threadsReady =
    /^MMS_THREADS_GAS_URL=.+$/m.test(envText) &&
    /^MMS_THREADS_GAS_KEY=.+$/m.test(envText) &&
    /^MMS_INGEST_SECRET=.+$/m.test(envText);
} catch {
  wpReady = false;
  threadsReady = false;
}
let dataforseoReady = false;
try {
  const envText = readFileSync(path.resolve(process.cwd(), "../../.env"), "utf8");
  dataforseoReady =
    /^MMS_DATAFORSEO_LOGIN=.+$/m.test(envText) && /^MMS_DATAFORSEO_PASSWORD=.+$/m.test(envText);
} catch {
  dataforseoReady = false;
}

const JOBS = [
  {
    name: "gsc-fetch-daily",
    schedule: "0 7 * * *", // 毎日 07:00 JST（§5.1 日次07:00）
    kind: "builtin",
    config: { script: "gsc_daily.py", timeoutSeconds: 1800 },
    // ★鍵が置かれたら自動で有効になる。無い間は停止（失敗で段7を汚さない）
    enabled: gscKeyReady,
    note: gscKeyReady
      ? "GSC日次取得: 最終取得日〜昨日の欠測を毎回埋める（§3.2.2）"
      : "GSC日次取得【停止中】secrets/gsc-service-account.json を置いて再実行すると有効化",
  },
  {
    name: "wp-sync-daily",
    schedule: "0 6 * * *", // 毎日 06:00 JST（GSC取得の前）
    kind: "builtin",
    config: { script: "wp_sync.py", timeoutSeconds: 900 },
    enabled: wpReady,
    note: wpReady
      ? "WP同期: 新規記事の取り込みとメタ差分の検出（§3.9.1・読み取りのみ）"
      : "WP同期【停止中】.env に MMS_WP_USER / MMS_WP_APP_PASSWORD を設定して再実行",
  },
  {
    name: "threads-sync-daily",
    // GAS 側の Insights 収集（日次06:00）が終わった頃に取りに行く
    schedule: "30 6 * * *",
    kind: "builtin",
    config: { script: "threads_sync.py", timeoutSeconds: 900 },
    enabled: threadsReady,
    note: threadsReady
      ? "Threads同期: GAS Web App から投稿実績と反応を pull（§13.4-④）"
      : "Threads同期【停止中】.env に MMS_THREADS_GAS_URL / MMS_THREADS_GAS_KEY / MMS_INGEST_SECRET を設定して再実行",
  },
  {
    name: "serp-fetch-weekly",
    // 月曜 03:00。立案（09:00）より前に競合順位を最新化しておく
    schedule: "0 3 * * 1",
    kind: "builtin",
    config: { script: "dataforseo_serp.py", timeoutSeconds: 3600 },
    enabled: dataforseoReady,
    note: dataforseoReady
      ? "SERP取得: 1〜20位の全ドメインとAIO有無を記録（§3.3.5・360KWで約$0.22/回）"
      : "SERP取得【停止中】.env に MMS_DATAFORSEO_LOGIN / MMS_DATAFORSEO_PASSWORD を設定して再実行",
  },
  {
    name: "operator-propose-weekly",
    schedule: "0 9 * * 1", // 毎週月曜 09:00 JST（§5.1 週次）
    kind: "http",
    config: { path: "/api/jobs/propose", timeoutSeconds: 300 },
    enabled: true,
    note: "立案: CTR異常 / striking distance / 弱いピラー から Action を起票",
  },
  {
    name: "intervention-evaluate-daily",
    schedule: "0 8 * * *", // 毎日 08:00 JST（§5.1 日次）
    kind: "http",
    config: { path: "/api/jobs/evaluate", timeoutSeconds: 600 },
    enabled: true,
    note: "判定: evaluateAt を迎えた Intervention を対照群補正つきで判定し Learning 生成",
  },
];

async function main() {
  for (const j of JOBS) {
    const { note, ...data } = j;
    await prisma.job.upsert({
      where: { name: j.name },
      update: { schedule: data.schedule, kind: data.kind, config: data.config, enabled: data.enabled },
      create: data,
    });
    console.log(`✓ ${j.name}  [${j.schedule}]  ${note}`);
  }
  console.log(
    "\n★これで立案・判定は worker が自動実行します（石井さんの操作は承認ボタンのみ）。",
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
