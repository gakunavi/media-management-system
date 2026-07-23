-- 何のためのジョブか／止めているなら理由。停止理由が無いと誰かが再有効化して同じ失敗を繰り返す。
ALTER TABLE "Job" ADD COLUMN "note" TEXT;
