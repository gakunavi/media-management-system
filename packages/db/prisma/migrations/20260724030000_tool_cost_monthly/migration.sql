-- ツールの月額を月次で残す。★過去は埋めない（未計測と0円は別・§3）
CREATE TABLE "ToolCostMonthly" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "toolId" TEXT,
    "monthlyYen" DECIMAL(12,2),
    "state" "ToolState" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ToolCostMonthly_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ToolCostMonthly_period_toolId_key" ON "ToolCostMonthly"("period","toolId");
CREATE INDEX "ToolCostMonthly_businessId_period_idx" ON "ToolCostMonthly"("businessId","period");
ALTER TABLE "ToolCostMonthly" ADD CONSTRAINT "ToolCostMonthly_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ToolCostMonthly" ADD CONSTRAINT "ToolCostMonthly_toolId_fkey"
  FOREIGN KEY ("toolId") REFERENCES "ToolSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
