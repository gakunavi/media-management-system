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

const JOBS = [
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
      update: { schedule: data.schedule, kind: data.kind, config: data.config },
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
