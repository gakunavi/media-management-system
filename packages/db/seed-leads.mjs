// 直客の遡及入力（P2.6・設計書 §14 前提の更新 / §15.2 の L-001）
//
// 出所: 経営戦略室/10_事業_節税商材代理店/04_数値KPI/2026-07-20_ML着金予定と直客初成約.md
//   ・入口: 問い合わせフォーム（/contact/）
//   ・属性: 個人事業主 / 予算=高（480万を購入）
//   ・購入: ML 2台（240万×2＝約480万）・購入確定・リーガルチェック中
//   ・比較していた商材: IoTビーコン端末・外貨両替機（＝ART-074 の比較表1・2番目）
//   ・provenance: 石井申告（declared）。正確な問い合わせ日は未確認
//
// ★冪等（externalId 相当の固定 id で upsert）。氏名・連絡先は元データに無いので入れない。
// ★併せて §1.1 の成功指標「リード数 月2件以上」を direct_inquiry の目標として設定する。
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BUSINESS_SLUG = "tax-saving-agency";
const LEAD_ID = "lead_retro_direct_L001"; // 固定id（再実行しても重複しない）
// 正確な問い合わせ日が不明なため、申告日を発生日として扱う（provenance=declared）
const OCCURRED_AT = new Date("2026-07-20T00:00:00+09:00");

async function main() {
  const business = await prisma.business.findUnique({ where: { slug: BUSINESS_SLUG } });
  if (!business) throw new Error(`Business(${BUSINESS_SLUG}) が無い。npm run db:seed を先に実行`);

  // 流入記事 ART-074（比較記事。買い手が比較した2商材が載っている）
  const art074 = await prisma.contentItem.findFirst({
    where: { externalId: "ART-074" },
    select: { id: true },
  });

  const data = {
    businessId: business.id,
    type: "direct_inquiry",
    sourceType: "form",
    status: "won", // 購入確定（内諾済み・リーガルチェック中）。商談以降の正は m2（§3.8.4）
    occurredAt: OCCURRED_AT,
    companyType: "sole_proprietor",
    budgetTier: "high",
    interestProduct: ["ML"],
    competitorsConsidered: ["IoTビーコン", "外貨両替機"],
    firstTouchContentId: art074?.id ?? null,
    lastTouchContentId: art074?.id ?? null,
    closedAmount: "4800000",
    closedAt: OCCURRED_AT,
    note:
      "P2.6 遡及入力。個人事業主・ML2台(240万×2=約480万)・購入確定/リーガルチェック中。" +
      "経路・日付は石井申告(2026-07-20, declared)。正確な問い合わせ日は未確認。商談以降はm2が正(§3.8.4)。",
  };

  await prisma.lead.upsert({
    where: { id: LEAD_ID },
    update: data,
    create: { id: LEAD_ID, ...data },
  });
  console.log(`直客リード（L-001相当）を遡及入力: ${LEAD_ID}`);
  console.log(`  流入記事 ART-074 紐付け: ${art074 ? "あり" : "★無し（ART-074が未移行）"}`);

  // 計測開始の記録（§3 規約）。これで段1が —(未計測) から実数に変わる
  const cov = await prisma.measurementCoverage.findFirst({
    where: { metric: "lead_direct_inquiry" },
  });
  if (!cov) {
    await prisma.measurementCoverage.create({
      data: {
        metric: "lead_direct_inquiry",
        startedAt: OCCURRED_AT,
        method: "mms_lead_retroactive",
        note: "P2.6: 直客の遡及入力により計測開始",
      },
    });
    console.log("MeasurementCoverage(lead_direct_inquiry) を記録");
  } else {
    console.log("MeasurementCoverage(lead_direct_inquiry) は既存");
  }

  // §1.1 成功指標「リード数 月2件以上」を direct_inquiry の目標に（合意済みの数値）
  const period = `${OCCURRED_AT.getFullYear()}-${String(OCCURRED_AT.getMonth() + 1).padStart(2, "0")}`;
  await prisma.target.upsert({
    where: { businessId_period_metric: { businessId: business.id, period, metric: "direct_inquiry" } },
    update: { targetValue: 2, tier: "north_star" },
    create: {
      businessId: business.id,
      period,
      metric: "direct_inquiry",
      targetValue: 2,
      tier: "north_star",
      parentMetric: null,
    },
  });
  console.log(`Target(direct_inquiry, ${period}) = 2件（§1.1 成功指標）`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
