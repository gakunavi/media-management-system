-- 代理店LP（外部ドメイン）の日次流入。PII は持たず件数のみ
CREATE TABLE "AgencyLpDaily" (
  "id" TEXT NOT NULL,
  "lp" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "agencyCode" TEXT NOT NULL,
  "visits" INTEGER NOT NULL DEFAULT 0,
  "inquiries" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgencyLpDaily_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgencyLpDaily_lp_date_agencyCode_key" ON "AgencyLpDaily"("lp","date","agencyCode");
CREATE INDEX "AgencyLpDaily_date_idx" ON "AgencyLpDaily"("date");
CREATE INDEX "AgencyLpDaily_agencyCode_idx" ON "AgencyLpDaily"("agencyCode");
