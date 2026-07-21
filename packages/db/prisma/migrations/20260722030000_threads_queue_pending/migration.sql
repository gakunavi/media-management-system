-- 投稿キューの残り本数。null は「取得できていない」で 0（本当に空）とは別（§3）
ALTER TABLE "SnsAccountHealth" ADD COLUMN "queuePending" INTEGER;
