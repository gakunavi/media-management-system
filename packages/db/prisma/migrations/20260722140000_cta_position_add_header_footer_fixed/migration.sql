-- CtaPosition に header / footer / fixed を追加する
--
-- 計測タグ（mms-bridge.js）が実サイトのDOMから判定して送ってくる位置は7種類ある。
-- enum が4種類しか知らない状態は実態を表せておらず、位置別の効き目を出せない。
--
-- ★ADD VALUE は既存行に影響しない（追加のみ）。
ALTER TYPE "CtaPosition" ADD VALUE IF NOT EXISTS 'header';
ALTER TYPE "CtaPosition" ADD VALUE IF NOT EXISTS 'footer';
ALTER TYPE "CtaPosition" ADD VALUE IF NOT EXISTS 'fixed';
