// MMS 共有定数・型（設計書 §4.1 / docs/RULES.md §4 に対応）

/** ダッシュボードのパネル番号。★docs/RULES.md §4 が正。段8以降を作らない */
export const PANELS = {
  1: "結果",
  2: "ファネル",
  3: "買い手の質",
  4: "今週の変化",
  5: "次の一手",
  6: "施策の生死",
  7: "ジョブ健全性",
} as const;

export type PanelNo = keyof typeof PANELS;

/**
 * 未計測の表示文字列。
 * ★docs/RULES.md §2: 行が無い＝未計測。決してゼロと書かない。
 */
export const NOT_MEASURED = "—(未計測)" as const;

/**
 * 計測値の表示。null/undefined（＝未計測）とゼロ（＝実測ゼロ）を厳密に区別する。
 * この関数を経由せずに数値を描画してはならない。
 */
export function formatMeasured(
  value: number | null | undefined,
  format: (n: number) => string = (n) => n.toLocaleString("ja-JP"),
): string {
  return value === null || value === undefined ? NOT_MEASURED : format(value);
}
