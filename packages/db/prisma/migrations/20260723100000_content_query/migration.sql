-- 記事が実際に何で検索されて表示されたか（GSC page×query）
-- ★これが無いと「記事のメインKW」を実測から決められない。
CREATE TABLE "ContentQuery" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION,
    "position" DOUBLE PRECISION,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentQuery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ContentQuery_contentItemId_query_periodStart_periodEnd_key"
  ON "ContentQuery"("contentItemId","query","periodStart","periodEnd");
CREATE INDEX "ContentQuery_contentItemId_clicks_idx" ON "ContentQuery"("contentItemId","clicks");
CREATE INDEX "ContentQuery_periodEnd_position_idx" ON "ContentQuery"("periodEnd","position");
CREATE INDEX "ContentQuery_query_idx" ON "ContentQuery"("query");
ALTER TABLE "ContentQuery" ADD CONSTRAINT "ContentQuery_contentItemId_fkey"
  FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
