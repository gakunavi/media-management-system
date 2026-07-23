-- 自社既存の共用資産（メディアのための追加コストは無いが、止まれば影響する）
ALTER TYPE "ToolBillingType" ADD VALUE IF NOT EXISTS 'shared';
