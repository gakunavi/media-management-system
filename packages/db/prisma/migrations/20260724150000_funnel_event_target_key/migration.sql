-- ════════════════════════════════════════════════════════════════════════
--  冪等キーに「何を見た/踏んだか」を含める（★手書きマイグレーション）
--
--  背景（2026-07-24 の実測で判明）
--    冪等キーは (sessionId, step, contentItemId, occurredAt秒) だった。
--    §4-94 で cta_view を自動化した結果、**同じ記事の別々のCTAが
--    同じ秒に並んで発火する**ようになり、キーが衝突して1件に潰れた。
--
--    実測: ART-002 で cta_view が3件（media-header / -material / -question）
--          発火したのに、DB に入ったのは **1件だけ**だった。
--
--    IntersectionObserver は人の操作と違って**同時に**発火する。
--    属性依存をやめて自動で拾うようにした時点で、この衝突は必然だった。
--
--  ★なぜキーを緩めるのではなく「対象」を足すのか
--    冪等キーの目的は「**同じ**イベントを二度数えない」こと。
--    別々のCTAを見たのは**別々のイベント**なので、キーが対象を
--    含んでいないことが誤りだった。秒を細かくする（ミリ秒にする）と
--    再送のたびに行が増え、本来の重複排除が壊れる。
--
--  対象の識別子は meta->>'href'。
--    - cta_view / link_click … 送り先URL（sanitizeLinkMeta で正規化済み）
--    - それ以外の段         … meta に href が無いので COALESCE で '' になり、
--                              従来どおり (session, step, content, 秒) で効く
--
--  ★Prisma は式インデックス（meta->>'href'）を表現できない。
--    NULLS NOT DISTINCT と同じ扱いで、`prisma migrate dev` が
--    「差分あり」と誤検知してこれを元に戻す migration を提案することがある。
--    **必ず --create-only で生成SQLを目視し、この DROP/CREATE が
--      混ざっていたら消すこと。** → docs/RULES.md §20-6
-- ════════════════════════════════════════════════════════════════════════

DROP INDEX IF EXISTS "FunnelEvent_sessionId_step_contentItemId_occurredAt_key";

CREATE UNIQUE INDEX "FunnelEvent_sessionId_step_contentItemId_occurredAt_key"
  ON "FunnelEvent" (
    "sessionId",
    step,
    "contentItemId",
    "occurredAt",
    (COALESCE(meta->>'href', ''))
  )
  NULLS NOT DISTINCT;
