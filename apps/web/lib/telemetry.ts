// ファネル計測の共通ロジック（設計書 §14.2 / §3.10 / §16.1-④）
//
// ★過去のサイト重量化事故（TTFBスパイク）の再発防止が最重要。
//   計測タグ側の7原則（docs/RULES.md §1）に対応するサーバー側の受け皿。

/** ファネル7段（§14.2）＋ phone_click（§3.8.3・P2.10）。schema の enum FunnelStep と一致 */
export const FUNNEL_STEPS = [
  "cta_view",
  "cta_click",
  "lp_view",
  "lp_scroll",
  "form_view",
  "form_field",
  "submit",
  "phone_click",
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
