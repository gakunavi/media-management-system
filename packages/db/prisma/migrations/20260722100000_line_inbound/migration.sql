-- 公式LINEの受信メッセージ。本文は暗号化して保存する（§16.2）
CREATE TABLE "LineInbound" (
  "id" TEXT NOT NULL,
  "lineUserId" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "kind" TEXT NOT NULL,
  "bodyEnc" TEXT,
  "handledAt" TIMESTAMP(3),
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LineInbound_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LineInbound_receivedAt_idx" ON "LineInbound"("receivedAt");
CREATE INDEX "LineInbound_lineUserId_idx" ON "LineInbound"("lineUserId");
CREATE INDEX "LineInbound_handledAt_idx" ON "LineInbound"("handledAt");
