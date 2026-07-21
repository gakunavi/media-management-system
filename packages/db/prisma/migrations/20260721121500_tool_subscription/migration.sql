-- CreateEnum
CREATE TYPE "ToolBillingType" AS ENUM ('monthly', 'prepaid', 'free');

-- CreateEnum
CREATE TYPE "ToolState" AS ENUM ('considering', 'trial', 'active', 'stopped');

-- CreateTable
CREATE TABLE "ToolSubscription" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vendor" TEXT,
    "plan" TEXT,
    "billingType" "ToolBillingType" NOT NULL DEFAULT 'monthly',
    "monthlyYen" DECIMAL(12,2),
    "balance" DECIMAL(14,4),
    "balanceCurrency" TEXT,
    "balanceCheckedAt" TIMESTAMP(3),
    "vendorKey" TEXT,
    "state" "ToolState" NOT NULL DEFAULT 'considering',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "purpose" TEXT NOT NULL,
    "expectedOutcome" TEXT,
    "decideBy" TIMESTAMP(3),
    "decision" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ToolSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ToolSubscription_state_idx" ON "ToolSubscription"("state");

-- CreateIndex
CREATE INDEX "ToolSubscription_decideBy_idx" ON "ToolSubscription"("decideBy");

-- CreateIndex
CREATE UNIQUE INDEX "ToolSubscription_businessId_name_key" ON "ToolSubscription"("businessId", "name");

-- AddForeignKey
ALTER TABLE "ToolSubscription" ADD CONSTRAINT "ToolSubscription_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
