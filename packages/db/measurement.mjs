// 計測開始／終了の記録（設計書 §3 MeasurementCoverage の規約）
//
//   行が存在しない = 「未計測」。UI/APIは "—(未計測)" と表示し、決してゼロと書かない
//   value = 0      = 「実測ゼロ」
//
// ★この記録を忘れると、その指標は永久に「未計測」扱いになる（docs/RULES.md §2-3）。
//   逆に、計測していないのに記録すると「0件」と表示され、**直客2件の見逃し事故が再発する**。
//
// 使い方:
//   npm run measurement -- list
//   npm run measurement -- start lead_direct_inquiry --method wp_form_webhook
//   npm run measurement -- stop  lead_direct_inquiry
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const [, , command, metric] = process.argv;

const fmt = (d) =>
  d ? new Date(d).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";

async function list() {
  const rows = await prisma.measurementCoverage.findMany({
    orderBy: { startedAt: "asc" },
  });
  if (rows.length === 0) {
    console.log(
      "計測中の指標はありません。\n" +
        "★この状態では全ての指標が「—(未計測)」です。0 件ではありません。",
    );
    return;
  }
  console.log("計測期間の記録:");
  for (const r of rows) {
    const state = r.endedAt ? "終了" : "計測中";
    console.log(
      `  [${state}] ${r.metric.padEnd(28)} ${fmt(r.startedAt)} 〜 ${fmt(r.endedAt)}  (${r.method})`,
    );
  }
}

async function start() {
  if (!metric) throw new Error("metric を指定してください");
  const open = await prisma.measurementCoverage.findFirst({
    where: { metric, endedAt: null },
  });
  if (open) {
    console.log(`既に計測中です: ${metric}（開始 ${fmt(open.startedAt)}）`);
    return;
  }
  const row = await prisma.measurementCoverage.create({
    data: {
      metric,
      startedAt: arg("at") ? new Date(arg("at")) : new Date(),
      method: arg("method", "manual"),
      note: arg("note"),
    },
  });
  console.log(`計測開始を記録しました: ${metric}（${fmt(row.startedAt)}）`);
  console.log("→ この指標は今後「0」と表示してよくなります（それ以前は —(未計測)）");
}

async function stop() {
  if (!metric) throw new Error("metric を指定してください");
  const open = await prisma.measurementCoverage.findFirst({
    where: { metric, endedAt: null },
  });
  if (!open) {
    console.log(`計測中の記録がありません: ${metric}`);
    return;
  }
  await prisma.measurementCoverage.update({
    where: { id: open.id },
    data: { endedAt: new Date() },
  });
  console.log(`計測終了を記録しました: ${metric}`);
}

const commands = { list, start, stop };

const run = commands[command];
if (!run) {
  console.error("使い方: npm run measurement -- <list|start|stop> [metric] [--method x] [--at ISO] [--note x]");
  process.exit(1);
}

run()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e.message);
    await prisma.$disconnect();
    process.exit(1);
  });
