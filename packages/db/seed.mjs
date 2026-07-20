// MMS 初期データ投入（P0）
//   実行: npm run db:seed
//
// 入れるもの:
//   1. FreshnessRule — 鮮度3階層ケイデンス（設計書 §7.5.1・docs/RULES.md §7）
//   2. owner ユーザー — MMS_OWNER_EMAIL があれば作成し role=owner にする
//
// ★冪等。何度実行しても同じ状態になる（upsert のみ）。
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 設計書 §7.5.1 の正典。breaking は「随時（法改正イベント駆動）」なので 0
const FRESHNESS_RULES = [
  {
    freshnessTier: "breaking",
    intervalDays: 0,
    description: "速報・税制改正。随時（法改正イベント駆動）",
  },
  {
    freshnessTier: "commercial",
    intervalDays: 75,
    description: "商用・税制系。60〜90日（既定75日）",
  },
  {
    freshnessTier: "evergreen",
    intervalDays: 180,
    description: "エバーグリーン・Pillar。6ヶ月",
  },
  {
    freshnessTier: "reference",
    intervalDays: 365,
    description: "定義・リファレンス。12ヶ月",
  },
];

async function main() {
  for (const rule of FRESHNESS_RULES) {
    await prisma.freshnessRule.upsert({
      where: { freshnessTier: rule.freshnessTier },
      update: { intervalDays: rule.intervalDays, description: rule.description },
      create: rule,
    });
  }
  console.log(`FreshnessRule: ${FRESHNESS_RULES.length} 件を投入しました`);

  const ownerEmail = process.env.MMS_OWNER_EMAIL?.trim();
  if (ownerEmail) {
    const user = await prisma.user.upsert({
      where: { email: ownerEmail },
      update: { role: "owner" },
      create: { email: ownerEmail, role: "owner" },
    });
    console.log(`owner ユーザー: ${user.email}（role=${user.role}）`);
  } else {
    console.log(
      "MMS_OWNER_EMAIL が未設定のため owner ユーザーは作成しません。\n" +
        "  → 初回ログインしたユーザーは role=readonly になります。",
    );
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
