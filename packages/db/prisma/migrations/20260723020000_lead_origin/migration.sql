-- 送客元（きっかけ）を持つ。受け皿（sourceType）と直交する軸。
--
-- ★電話・info メールは自動取得できないが「測定不能」ではない。
--   ヒアリングして記録すれば施策の成果として数えられる（2026-07-23 石井さん）。
CREATE TYPE "LeadOrigin" AS ENUM (
  'media_article', 'threads', 'line', 'lp_diagnosis', 'lp_product', 'hp', 'referral', 'unknown'
);

ALTER TABLE "Lead" ADD COLUMN "origin" "LeadOrigin" NOT NULL DEFAULT 'unknown';

-- 既に分かっているものは埋める。分からないものは unknown のまま（§3）
UPDATE "Lead" SET "origin" = 'threads' WHERE "sourceType" = 'threads_dm';
UPDATE "Lead" SET "origin" = 'line' WHERE "sourceType" = 'line';
UPDATE "Lead" SET "origin" = 'lp_diagnosis' WHERE "sourceType" = 'lp_diagnosis';
UPDATE "Lead" SET "origin" = 'lp_product' WHERE "sourceType" = 'lp_agency';
UPDATE "Lead" SET "origin" = 'media_article' WHERE "firstTouchContentId" IS NOT NULL AND "origin" = 'unknown';
