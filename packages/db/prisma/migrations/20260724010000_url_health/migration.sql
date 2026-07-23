-- 登録URLが本当に生きているかの日次チェック。
-- ★台帳の突合だけでは「登録は正しいが本番が壊れている」を拾えない。
CREATE TABLE "UrlHealthCheck" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT,
    "url" TEXT NOT NULL,
    "finalStatus" INTEGER NOT NULL,
    "hops" INTEGER NOT NULL,
    "loop" BOOLEAN NOT NULL DEFAULT false,
    "chain" JSONB,
    "checkedAt" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UrlHealthCheck_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UrlHealthCheck_url_checkedAt_key" ON "UrlHealthCheck"("url","checkedAt");
CREATE INDEX "UrlHealthCheck_checkedAt_loop_idx" ON "UrlHealthCheck"("checkedAt","loop");
CREATE INDEX "UrlHealthCheck_contentItemId_idx" ON "UrlHealthCheck"("contentItemId");
ALTER TABLE "UrlHealthCheck" ADD CONSTRAINT "UrlHealthCheck_contentItemId_fkey"
  FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
