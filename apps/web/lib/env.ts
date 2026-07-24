// 環境変数の読み取り（2026-07-24 の誤報から）
//
// ★なぜ要るか
//   `process.env.X ?? "既定値"` は **空文字にフォールバックしない**（?? は null/undefined のみ）。
//   docker-compose が `X: ${X:-}` で渡していると、.env に定義が無いとき
//   **undefined ではなく空文字**がコンテナに入る。結果、既定値が使われず
//   `"" + "/api/ingest/form"` = `/api/ingest/form` という**相対URL**になり、
//   死活監視が「つながらない」と判定して**偽のダウン通知**を出した（17:40）。
//   受口は 405 を返して生きていた。
//
//   誤報は「通知そのものが無視されるようになる」形で効いてくるので、
//   本物の障害を見逃す原因になる。読み取り側で吸収する。
/** 空文字も「未設定」として扱う。★`??` を直接使わない */
export function env(name: string): string | null {
  const v = process.env[name];
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/** 未設定なら既定値。空文字も未設定として扱う */
export function envOr(name: string, fallback: string): string {
  return env(name) ?? fallback;
}

/** URL 用。末尾のスラッシュを落とす（結合時の `//` を防ぐ） */
export function envUrl(name: string, fallback: string): string {
  return envOr(name, fallback).replace(/\/+$/, "");
}
