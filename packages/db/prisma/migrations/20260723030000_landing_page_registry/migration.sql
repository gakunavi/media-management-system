-- LPを台帳で管理する（2026-07-23 石井さん）
--
-- ★LPは今後増える（商材別・総合窓口・代理店募集…）。画面に直書きしていると
--   増えた瞬間に破綻する。どのLPも同じ読み方で数字が出るように台帳を持つ。
ALTER TABLE "LandingPage" ADD COLUMN "variantKeys" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "LandingPage" ADD COLUMN "metricPrefix" TEXT;
ALTER TABLE "LandingPage" ADD COLUMN "hasAgencyCodes" BOOLEAN NOT NULL DEFAULT false;
