-- 記事内リンクのクリックを1段として持つ。
-- ★リダイレクタ（/r/）の送り元は設置場所IDだけで記事を持たないため、
--   「どの記事の・どのリンクが踏まれたか」がどこにも残っていなかった。
ALTER TYPE "FunnelStep" ADD VALUE IF NOT EXISTS 'link_click';
