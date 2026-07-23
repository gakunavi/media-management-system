-- 記事の読者と内容の型（2026-07-23 石井さん）
--
-- ★budgetTier を記事に流用したのは誤りだった。あれは商談相手の予算区分で、
--   記事から読者の予算規模は決まらない（同じ両替機の記事を1台350万で買う人と
--   数千万分買う人が読む）。記事について確実に言えるのは「誰に向けて何を書いたか」。
--
-- ★audience は既に String[] で存在していたが 0件のまま使われていなかった。
--   自由文字列だと表記ゆれで集計が割れるので enum 化する。
--   複数指定できる形は残す（法人にも個人事業主にも効く記事が実在する）。
CREATE TYPE "ContentAudience" AS ENUM ('corporate', 'sole_proprietor', 'both', 'partner');
CREATE TYPE "ContentFormat" AS ENUM ('product', 'comparison', 'system', 'news', 'howto', 'risk', 'case_study');

-- 既存データは0件なので、型を差し替えるだけでよい
ALTER TABLE "ContentItem" DROP COLUMN "audience";
ALTER TABLE "ContentItem" ADD COLUMN "audience" "ContentAudience"[] DEFAULT ARRAY[]::"ContentAudience"[];
ALTER TABLE "ContentItem" ADD COLUMN "contentFormat" "ContentFormat";

CREATE INDEX "ContentItem_contentFormat_idx" ON "ContentItem"("contentFormat");
