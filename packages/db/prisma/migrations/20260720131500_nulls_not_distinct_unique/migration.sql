-- ════════════════════════════════════════════════════════════════════════
--  NULL を含む一意制約を実際に効かせる（★手書きマイグレーション）
--
--  背景: docs/PHASES.md §8 U27 / §9.1 N1 / docs/RULES.md §20-6
--    PostgreSQL は既定で NULL を「互いに異なる値」として扱うため、
--    NULL 可能な列を含む UNIQUE 制約は、その列が NULL の行に対して効かない。
--    例: MetricSnapshot(channelId = NULL) の行は何行でも重複して入れられる。
--
--  影響: これを放置すると
--    - 設計書 §16.1-④「冪等キーで重複排除」が機能せず、二重計測を防げない
--    - §3.2.2 の欠測 backfill が再実行のたびに行を増やす
--
--  対策: PostgreSQL 15+ の `NULLS NOT DISTINCT` を使い、
--    NULL 同士を「同じ値」とみなす一意インデックスに貼り替える。
--    （本番は PostgreSQL 16 なので利用可能）
--
--  ★Prisma は NULLS NOT DISTINCT を表現できない。
--    そのため `prisma migrate dev` が「差分あり」と誤検知して
--    このインデックスを元に戻す migration を提案することがある。
--    **スキーマ変更時は必ず `prisma migrate dev --create-only` で
--      生成された SQL を目視し、この DROP/CREATE が混ざっていたら消すこと。**
--    → docs/RULES.md §20-6
-- ════════════════════════════════════════════════════════════════════════

-- ── §3 MetricSnapshot: channelId が NULL＝事業全体の指標 ──────────────
DROP INDEX IF EXISTS "MetricSnapshot_businessId_channelId_metric_date_granularity_key";
CREATE UNIQUE INDEX "MetricSnapshot_businessId_channelId_metric_date_granularity_key"
  ON "MetricSnapshot" ("businessId", "channelId", "metric", "date", "granularity")
  NULLS NOT DISTINCT;

-- ── §3 FunnelEvent: §16.1-④ の冪等キー。contentItemId は NULL になりうる ──
DROP INDEX IF EXISTS "FunnelEvent_sessionId_step_contentItemId_occurredAt_key";
CREATE UNIQUE INDEX "FunnelEvent_sessionId_step_contentItemId_occurredAt_key"
  ON "FunnelEvent" ("sessionId", "step", "contentItemId", "occurredAt")
  NULLS NOT DISTINCT;

-- ── §3 AdMetricDaily: adGroupId / creativeId が NULL＝キャンペーン単位の行 ──
DROP INDEX IF EXISTS "AdMetricDaily_campaignId_adGroupId_creativeId_date_key";
CREATE UNIQUE INDEX "AdMetricDaily_campaignId_adGroupId_creativeId_date_key"
  ON "AdMetricDaily" ("campaignId", "adGroupId", "creativeId", "date")
  NULLS NOT DISTINCT;

-- ── §3.8.1 SeasonalityIndex: clusterId / keywordId は排他的に片方が NULL ──
DROP INDEX IF EXISTS "SeasonalityIndex_clusterId_keywordId_month_key";
CREATE UNIQUE INDEX "SeasonalityIndex_clusterId_keywordId_month_key"
  ON "SeasonalityIndex" ("clusterId", "keywordId", "month")
  NULLS NOT DISTINCT;

-- ── §3.6.3 Backlink: targetContentId が NULL＝ドメイン宛の被リンク ────────
DROP INDEX IF EXISTS "Backlink_sourceUrl_targetContentId_key";
CREATE UNIQUE INDEX "Backlink_sourceUrl_targetContentId_key"
  ON "Backlink" ("sourceUrl", "targetContentId")
  NULLS NOT DISTINCT;

-- ── §3.5.2 InternalLink: anchorText が NULL＝アンカーテキスト未取得 ───────
DROP INDEX IF EXISTS "InternalLink_srcContentId_dstContentId_anchorText_key";
CREATE UNIQUE INDEX "InternalLink_srcContentId_dstContentId_anchorText_key"
  ON "InternalLink" ("srcContentId", "dstContentId", "anchorText")
  NULLS NOT DISTINCT;
