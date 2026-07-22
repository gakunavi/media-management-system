-- 人主導の施策を記録できるようにする（cowork の intervention-record.py から移管）
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'rewrite';
ALTER TYPE "ActionType" ADD VALUE IF NOT EXISTS 'merge';
