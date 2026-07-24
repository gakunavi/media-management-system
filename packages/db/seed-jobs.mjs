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
// ★AIO引用率の計測（2026-07-23 Notion から移設）。
//   ChatGPT / Gemini に質問して自社が引用されるかを測る。
//
// ★鍵があっても「使えるか」は別問題（2026-07-23 実際に起きた）。
//   OpenAI のクレジットを止めている間、ジョブは毎回 429 で失敗し、
//   hot は 60分タイムアウト、cold は12連続失敗で中断していた。
//   失敗が毎週積み上がると、段7の異常通知が無視されるようになり
//   **本当の異常を見落とす**。鳴らないようにするのではなく、
//   動かせない間は止めておくのが正しい。
//
//   ★Gemini だけで回す選択もあるが、実測で Gemini は
//     1382試行 0ヒット（chatgpt は 1966試行 71ヒット）。
//     Gemini 単独では測る意味がないので、OpenAI が使えることを条件にする。
//
//   再開するときは .env の MMS_AIO_ENABLED を 1 にして npm run seed:jobs。
let aioReady = false;
try {
  const envText = readFileSync(path.resolve(process.cwd(), "../../.env"), "utf8");
  aioReady =
    /^OPENAI_API_KEY=.+$/m.test(envText) && /^MMS_AIO_ENABLED=1$/m.test(envText);
} catch {
  aioReady = false;
}
// ★公式LINE の友だち数（Messaging API）。トークンが無ければ動かさない
let lineReady = false;
try {
  const envText = readFileSync(path.resolve(process.cwd(), "../../.env"), "utf8");
  lineReady = /^MMS_LINE_CHANNEL_ACCESS_TOKEN=.+$/m.test(envText);
} catch {
  lineReady = false;
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
    name: "aio-hot-weekly",
    // 木 02:00。Hot は週次（旧 cowork Scheduled aio-batch-hot と同じ枠）
    schedule: "0 2 * * 4",
    kind: "builtin",
    config: { script: "aio_run.py", args: ["--tier", "hot"], timeoutSeconds: 3600 },
    enabled: aioReady,
    note: aioReady
      ? "AIO計測(Hot): ChatGPT/Gemini に質問し引用率を記録。終わったらTier昇降格"
      : "AIO計測(Hot)【停止中】.env に MMS_AIO_ENABLED=1 を設定して再実行（OpenAI クレジットが要る）",
  },
  {
    name: "aio-warm-biweekly",
    // 木 03:30。Warm は隔週だが cron に隔週は無いので毎週動かし、
    // ★スクリプト側が「前回から14日未満なら何もしない」で吸収する方が安全。
    //   cron の date 演算（%U % 2）は年跨ぎでずれる。
    schedule: "30 3 * * 4",
    kind: "builtin",
    config: { script: "aio_run.py", args: ["--tier", "warm"], timeoutSeconds: 3600 },
    enabled: aioReady,
    note: aioReady
      ? "AIO計測(Warm): 隔週相当。60日 baseline 期間の記事が対象"
      : "AIO計測(Warm)【停止中】.env に MMS_AIO_ENABLED=1 を設定して再実行（OpenAI クレジットが要る）",
  },
  {
    name: "aio-cold-monthly",
    // 毎月 1〜7日の木 05:00 ＝ 第1木曜
    schedule: "0 5 1-7 * 4",
    kind: "builtin",
    config: { script: "aio_run.py", args: ["--tier", "cold"], timeoutSeconds: 3600 },
    enabled: aioReady,
    note: aioReady
      ? "AIO計測(Cold): 月次。chatgpt 1試行のみ（費用を抑える）"
      : "AIO計測(Cold)【停止中】.env に MMS_AIO_ENABLED=1 を設定して再実行（OpenAI クレジットが要る）",
  },
  {
    name: "line-followers-daily",
    // 毎日 07:45。GA4(07:30) の後、アラート(09:30) の前に入れる
    schedule: "45 7 * * *",
    kind: "builtin",
    config: { script: "line_followers.py", timeoutSeconds: 600 },
    enabled: lineReady,
    note: lineReady
      ? "公式LINE友だち数: Messaging API から日次取得（Webhook 観測分では取りこぼすため）"
      : "公式LINE友だち数【停止中】.env に MMS_LINE_CHANNEL_ACCESS_TOKEN を設定して再実行",
  },
  {
    name: "rakko-import-daily",
    // 毎日 05:00。cowork が置いたファイルがあれば取り込む（無ければ即終了）
    schedule: "0 5 * * *",
    kind: "builtin",
    config: { script: "rakko_import.py", timeoutSeconds: 600 },
    enabled: true,
    note: "ラッコ取り込み: data/rakko-inbox のエクスポートを KeywordResearch へ（§3-8）",
  },
  {
    name: "tool-balance-daily",
    // 毎日 04:00。SERP取得(月曜03:00)の後、他ジョブの前に残高を更新する
    schedule: "0 4 * * *",
    kind: "builtin",
    config: { script: "tool_balance.py", timeoutSeconds: 300 },
    enabled: true,
    note: "ツール残高: API取得できるものを更新し、枯渇を段7で警告（/costs）",
  },
  {
    name: "telemetry-volume-hourly",
    // 毎時5分。★1時間ぶんを確定させてから見る（進行中の時間は数字が動くため）
    schedule: "5 * * * *",
    kind: "http",
    config: { path: "/api/jobs/telemetry", timeoutSeconds: 120 },
    enabled: true,
    note: "計測量の監視: 1人あたりの発火回数を確定し、急増なら停止提案を段5に出す（§3.10.4）",
  },
  {
    name: "uptime-check-5min",
    // ★5分間隔（§3.9.3）。連続3回＝15分落ちていれば通知する。
    //   1回で鳴らすと瞬断のたびに飛んで、通知そのものが無視されるようになる。
    schedule: "*/5 * * * *",
    kind: "http",
    config: { path: "/api/jobs/uptime", timeoutSeconds: 120 },
    enabled: true,
    note: "死活監視: トップ・代表記事・LP・問い合わせの受口を5分ごとに確認（連続3回失敗で通知）",
  },
  {
    name: "tag-delivery-daily",
    // 05:50。url-health(05:20) / ledger-check(05:40) の後。
    // ★役割が違う: url_health は §4-44 でキャッシュを迂回して「原因」を見る。
    //   こちらは §4-95 で読者と同じ条件のまま叩いて「届いているか」を見る。
    schedule: "50 5 * * *",
    kind: "builtin",
    config: { script: "tag_delivery.py", timeoutSeconds: 1800 },
    enabled: true,
    note: "計測タグ配信: 読者と同じ条件で叩き、届いていない記事を検出（あればCloudflareを自動パージ）",
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
    name: "ideas-collect-weekly",
    // 月曜 08:30。立案(09:00)の直前にネタを補充しておく
    schedule: "30 8 * * 1",
    kind: "http",
    config: { path: "/api/jobs/ideas", timeoutSeconds: 300 },
    enabled: true,
    note: "ネタ供給: Threads反響（§13.4-④）とAIO未引用（§3.3.6）から自動起票",
  },
  {
    name: "ga4-fetch-daily",
    // 毎日 07:30。GSC取得(07:00)の直後。GA4は当日分が確定しないので前日まで取る
    schedule: "30 7 * * *",
    kind: "builtin",
    config: { script: "ga4_daily.py", timeoutSeconds: 1800 },
    enabled: true,
    note: "GA4日次取得: 記事別PVと診断LPのファネルを一次ソースから直接（Notion経由をやめた）",
  },
  {
    name: "agency-lp-import-daily",
    // 毎日 07:15。GA4取得(07:30)の前。外部LPの export.php から取る
    schedule: "15 7 * * *",
    kind: "builtin",
    config: { script: "agency_lp_import.py", timeoutSeconds: 300 },
    enabled: true,
    note: "代理店LP取り込み: 配布コード別の訪問/問い合わせ（PRJ-034・PIIは保存しない）",
  },
  {
    name: "dm-log-import-daily",
    // 毎日 10:00。cowork の日次監視（DM検知・返信案作成）が終わった後に取り込む
    schedule: "0 10 * * *",
    kind: "builtin",
    config: { script: "dm_log_import.py", timeoutSeconds: 300 },
    enabled: true,
    note: "代理店DM取り込み: cowork の dm-log.md を AgencyLead へ（§3-6・読み取りのみ）",
  },
  {
    name: "queue-refill-daily",
    // 毎日 05:00。その日の初回投稿（07:00）より前に補充を終える
    schedule: "0 5 * * *",
    kind: "http",
    config: { path: "/api/jobs/queue-refill", timeoutSeconds: 900 },
    enabled: true,
    note: "投稿キュー自動補充: cowork が生成した draft を承認なしで公開待ちへ（YMYL違反のみ保留）",
  },
  {
    name: "health-alert-daily",
    // 毎朝 09:30。日次ジョブが一通り終わった後に、異常だけを通知する
    schedule: "30 9 * * *",
    kind: "http",
    config: { path: "/api/jobs/alerts", timeoutSeconds: 120 },
    enabled: true,
    note: "運用アラート: 段7の異常（欠測/配信停止/残高/ジョブ失敗）をSlackへ（§5.4）",
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
