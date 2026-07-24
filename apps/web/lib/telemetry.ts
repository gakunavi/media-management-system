// ファネル計測の共通ロジック（設計書 §14.2 / §3.10 / §16.1-④）
//
// ★過去のサイト重量化事故（TTFBスパイク）の再発防止が最重要。
//   計測タグ側の7原則（docs/RULES.md §1）に対応するサーバー側の受け皿。

/**
 * ファネル7段（§14.2）＋ phone_click（§3.8.3・P2.10）＋ link_click。
 * schema の enum FunnelStep と一致させる。
 *
 * ★link_click を足した理由（2026-07-23）
 *   記事の目的は送客だが、「どの記事の・どのリンクが踏まれたか」を持っていなかった。
 *   リダイレクタ（/r/）の送り元は設置場所IDだけで記事を持たず、
 *   計測タグ側は data-mms を貼った要素しか見ていなかった（実際0件だった）。
 *   計測タグが記事内の a[href] を自前で拾えば、WordPress 側を触らずに
 *   記事別のリンク実績が取れる（記事には既に data-article が入っている）。
 */
export const FUNNEL_STEPS = [
  "cta_view",
  "cta_click",
  "lp_view",
  "lp_scroll",
  "form_view",
  "form_field",
  "submit",
  "phone_click",
  "link_click",
] as const;

export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export function isFunnelStep(v: unknown): v is FunnelStep {
  return typeof v === "string" && (FUNNEL_STEPS as readonly string[]).includes(v);
}

/**
 * 冪等キーの秒丸め（§16.1-④）。
 * 一意制約 (sessionId, step, contentItemId, occurredAt) は「occurredAt秒」で効かせる。
 * ミリ秒が違うだけの重複を弾くため、ミリ秒を 0 に落とす。
 */
export function truncateToSecond(d: Date): Date {
  const t = new Date(d);
  t.setMilliseconds(0);
  return t;
}

/**
 * セッションID / 訪問者ID の形式検証。
 * クライアントが採番した値をそのまま主キーに使うため、暴走・注入を防ぐ。
 */
export function isValidClientId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(v);
}

/**
 * 送信元オリジンの検証。
 * ★ブラウザ計測タグは共有シークレットを持てない（クライアントに露出するため
 *   HMAC は使えない）。代わりに Origin allowlist ＋ レート制限 ＋ 冪等キーで守る。
 *   allowlist 未設定なら開発とみなして許可する。
 */
export function isAllowedOrigin(origin: string | null): boolean {
  const allow = process.env.MMS_INGEST_ALLOWED_ORIGINS?.trim();
  if (!allow) return true; // 未設定＝開発。本番では必ず設定する（docs/INTEGRATIONS.md）
  if (!origin) return false;
  const list = allow.split(",").map((s) => s.trim()).filter(Boolean);
  return list.includes(origin);
}

/** 1セッションが1リクエストで送れるイベント数の上限（§3.10.3-⑦ のサーバー側担保） */
export const MAX_EVENTS_PER_REQUEST = 50;

/**
 * リンク種別。link_click の meta.kind に入る値。
 *   internal   同じサイト内（回遊）
 *   outbound   外部サイト
 *   redirect   自前のリダイレクタ /r/{dest}/{source}（＝送客の本命）
 *   tel        tel: リンク
 *   mail       mailto: リンク
 *   anchor     ページ内アンカー
 */
export const LINK_KINDS = ["internal", "outbound", "redirect", "tel", "mail", "anchor"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/** 記事内のどの位置に置かれたリンクか。link_click の meta.area に入る */
export const LINK_AREAS = ["body", "header", "footer", "nav", "sidebar", "unknown"] as const;

const MAX_HREF = 300;
const MAX_TEXT = 60;

/**
 * 計測タグから来た link_click の meta を、保存してよい形に削る。
 *
 * ★クライアントが送ってきた任意の JSON をそのまま jsonb に入れない。
 *   長さ無制限の href やアンカー文字列がそのまま溜まると、
 *   行が肥大して集計が重くなり、個人情報が混ざる経路にもなる。
 *   ここで **キーを固定し・長さを切り・語彙外を落とす**。
 * ★クエリ文字列は落とす。UTM や個人を含みうるパラメータを残さない。
 *   ただしリダイレクタは経路そのものなのでパスは残す。
 */
/**
 * href を保存してよい形にする。
 *
 * ★ベースURL付きの `new URL()` を使わない。
 *   計測タグは既に `host + pathname`（スキーム無し）に削って送ってくるため、
 *   ベース付きで解釈すると相対パス扱いになり、
 *   `collect.asset-support.co.jp/r/line/x` が
 *   `example.invalid/collect.asset-support.co.jp/r/line/x` に化ける。
 *   実際に化けた（2026-07-23 の投入テストで検出）。
 * ★スキーム付きで来たときだけ URL として解釈し、host+path に落とす。
 *   それ以外は ? と # で切る（クエリに UTM や個人を含む値を溜めない）。
 */
function normalizeHref(raw: string): string {
  let href = raw.trim();
  if (/^https?:\/\//i.test(href)) {
    try {
      const u = new URL(href);
      href = `${u.host}${u.pathname}${u.hash}`;
    } catch {
      /* 壊れた絶対URLは下の素朴な切り出しに任せる */
    }
  }
  // ★クエリだけ落とす。#断片は残す（目次リンクの飛び先が消えるため）。
  //   tel: / mailto: はそのまま（何を踏んだかが消える）
  if (!/^(tel|mailto):/i.test(href)) {
    const [head, ...rest] = href.split("#");
    const hash = rest.length > 0 ? `#${rest.join("#")}` : "";
    href = head.split("?")[0] + hash;
  }
  return href.slice(0, MAX_HREF);
}

/**
 * 計測タグが送ってくる path の正規化（前後のスラッシュを落として小文字化）。
 * クエリと #断片は捨てる（LP の同定にしか使わないうえ、UTM や個人を含みうる）。
 */
export function normalizePath(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const head = v.split("#")[0].split("?")[0];
  if (head.length > 512) return null; // 異常に長い path は捨てる（暴走・注入の防止）
  return head.replace(/^\/+|\/+$/g, "").toLowerCase();
}

/**
 * path から LandingPage を同定する（★lpId をタグの属性に頼らない）。
 *
 * ★なぜサーバー側で解決するか（2026-07-24・§4-94）
 *   タグは `data-lp` が付いたページでしか lp_view / lp_scroll を送らない作りだった。
 *   ところが**診断LPの script タグに `data-lp` が無く**、最も重要な転換ページで
 *   LP到達が1件も記録されていなかった。§4-18 で link_click を属性依存から外したのに、
 *   LP・CTA・フォームは属性依存のまま残っていた。
 *   属性の貼り漏れは画面に出ないので、貼らせる設計にしてはいけない。
 *
 * ★A/B は「1つのLPのバリアント」（§9-D24）。`/setsuzei-diagnosis-a/` も `-b/` も
 *   同じ LandingPage に解決し、末尾の記号を variant として返す。
 *   LandingPage.url は代表1本（実測では -b）しか持たないため、url 一致では a/c が漏れる。
 */
export function resolveLandingPage(
  path: string | null,
  lps: { id: string; slug: string; variantKeys: string[] }[],
): { lpId: string; variant: string | null } | null {
  if (!path) return null;
  for (const lp of lps) {
    const slug = lp.slug.toLowerCase();
    if (path !== slug && !path.startsWith(`${slug}-`)) continue;
    const rest = path.slice(slug.length).replace(/^-/, "");
    const variant = lp.variantKeys.map((k) => k.toLowerCase()).includes(rest) ? rest : null;
    // ★slug で始まるが既知のバリアントでもない path（別記事など）は取り違えになるので捨てる
    if (rest && !variant) continue;
    return { lpId: lp.id, variant };
  }
  return null;
}

export function sanitizeLinkMeta(meta: unknown): Record<string, string> | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as Record<string, unknown>;
  const out: Record<string, string> = {};

  const kind = typeof m.kind === "string" ? m.kind : "";
  out.kind = (LINK_KINDS as readonly string[]).includes(kind) ? kind : "outbound";

  const area = typeof m.area === "string" ? m.area : "";
  out.area = (LINK_AREAS as readonly string[]).includes(area) ? area : "unknown";

  if (typeof m.href === "string" && m.href) {
    out.href = normalizeHref(m.href);
  }
  if (typeof m.text === "string" && m.text.trim()) {
    out.text = m.text.trim().replace(/\s+/g, " ").slice(0, MAX_TEXT);
  }
  return Object.keys(out).length > 0 ? out : null;
}
