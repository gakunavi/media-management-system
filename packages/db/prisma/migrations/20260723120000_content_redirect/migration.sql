-- 301 の転送先。301元が「競合記事」として集計に混ざるのを防ぐために要る。
ALTER TABLE "ContentItem" ADD COLUMN "redirectsToId" TEXT;
CREATE INDEX "ContentItem_redirectsToId_idx" ON "ContentItem"("redirectsToId");
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_redirectsToId_fkey"
  FOREIGN KEY ("redirectsToId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
