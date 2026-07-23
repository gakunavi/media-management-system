-- 変動費（前払い/従量）を固定費と分けて記録する。
-- ★合計だけ見ると「使っていないのに高い」と「使った結果高い」が区別できない。
ALTER TABLE "ToolCostMonthly" ADD COLUMN "variableYen" DECIMAL(12,2);
ALTER TABLE "ToolCostMonthly" ADD COLUMN "variableAmount" DECIMAL(14,4);
ALTER TABLE "ToolCostMonthly" ADD COLUMN "variableCurrency" TEXT;
ALTER TABLE "ToolCostMonthly" ADD COLUMN "balanceSnapshot" DECIMAL(14,4);
