// YMYL 禁止表現チェッカー（gas/Threads.gs の checkYMYL_ v2.2 と同じ規則）
//
// ★なぜ二重に持つのか
//   投稿の最終防波堤は GAS 側（投稿直前）にある。ここはその手前で、
//   **承認画面に出す前に危ない下書きを見えるようにする**ためのもの。
//   石井さんが承認ボタンを押した後に GAS で弾かれると、
//   「承認したのに出ていない」という一番わかりにくい状態になる。
//
// ★規則を変えるときは両方を同時に直すこと。
//   片方だけ緩めると、画面上は安全に見えて投稿が全部 error になる（逆も同じ）。
//   規則の根拠と誤検出の履歴は gas/Threads.gs のコメントに残してある。

/** 「効果の主張」。断定語の直後にこれが来るときだけ違反とみなす */
const BENEFIT =
  "[^。、\\n取]{0,4}(?:節税|減税|還付|戻り|戻る|得する|得し|得られ|儲か|安くな|下が|有利|安全|保証)";

/**
 * 打ち消し文脈の煽り語。
 * 「派手な裏ワザではなく王道を」は煽りではなく、むしろ推奨したい書き方。
 */
const NEGATED_HYPE =
  /(?:裏ワザ|裏技)(?:ではなく|ではありません|じゃなく|より|に頼ら|は不要|は存在し|などない|はない)/g;

const RULES: { pattern: RegExp; label: string }[] = [
  // 断定表現
  { pattern: /必ず(?:節税できる|儲かる|得する|減税|戻る)/, label: "断定「必ず〜」" },
  { pattern: new RegExp("確実に" + BENEFIT), label: "断定「確実に〜」" },
  { pattern: /絶対に?(?:節税|得|儲|損しない)/, label: "断定「絶対に〜」" },
  { pattern: new RegExp("間違いなく" + BENEFIT), label: "断定「間違いなく〜」" },
  { pattern: new RegExp("100\\s*[%％]" + BENEFIT), label: "断定「100%〜」" },
  { pattern: /guaranteed|保証します/, label: "保証表現" },
  // 煽り表現
  { pattern: /知らないと損/, label: "煽り「知らないと損」" },
  { pattern: /驚異の/, label: "煽り「驚異の」" },
  { pattern: /ヤバい|やばい/, label: "煽り「ヤバい」" },
  { pattern: /衝撃[のな]/, label: "煽り「衝撃の」" },
  { pattern: /驚愕/, label: "煽り「驚愕」" },
  { pattern: /業界の闇/, label: "煽り「業界の闇」" },
  { pattern: /9割が知らない/, label: "煽り「9割が知らない」" },
  { pattern: /裏ワザ|裏技/, label: "煽り「裏ワザ」" },
  // 個別税務アドバイス
  { pattern: /あなたは?\d+万?円(?:節税|得|戻)/, label: "個別シミュレーション" },
  { pattern: /○○の場合は△△円/, label: "個別税務アドバイス" },
];

/** Threads の本文上限（gas/Config.gs の TEXT_MAX_CHARS と同じ） */
export const TEXT_MAX_CHARS = 500;

export type YmylCheck = {
  ok: boolean;
  violations: string[];
  /** 文字数超過は YMYL とは別問題だが、承認前に見えないと困るので併せて返す */
  tooLong: boolean;
  length: number;
};

export function checkYmyl(text: string): YmylCheck {
  const raw = String(text ?? "");
  const scanned = raw.replace(NEGATED_HYPE, "");
  const violations = RULES.filter((r) => r.pattern.test(scanned)).map((r) => r.label);
  const tooLong = raw.length > TEXT_MAX_CHARS;
  return { ok: violations.length === 0 && !tooLong, violations, tooLong, length: raw.length };
}
