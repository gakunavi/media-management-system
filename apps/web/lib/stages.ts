// 経路の階段（共通ロジック）
//
// ★段の並び・転換率・最大ドロップの求め方を1か所に集める。
//   同じ計算が /line・/lp・ダッシュボードに3つ書かれていて、
//   直すときに1つ直し忘れると画面ごとに違う結論が出る。
//
// ★最大ドロップは「算出できる区間が2つ以上あるとき」だけ出す。
//   区間が1つしかないとき、その1つが必ず「最大ドロップ」になる。
//   実際ダッシュボードは、計測できている区間が 表示→クリック しか無いのに
//   「最大ドロップ: 表示→クリック」と断定していた。CTRが100%でない以上
//   そこは必ず落ちるので、これは情報がゼロの上に誤誘導する（§16.5）。

export type Stage = {
  key: string;
  label: string;
  /** null = 未計測。0 とは意味が違う（§3） */
  value: number | null;
  /**
   * value が null のときの表示。既定は「—(未計測)」。
   *
   * ★「まだ測っていない」と「結果がまだ出ていない」は別物。
   *   選別中のDMを未計測と書くと計装の不備に見え、
   *   0 と書くと失敗に見える。どちらでもない状態を持てるようにする。
   */
  pendingLabel?: string;
  /** その段が何を意味するか */
  hint: string;
  /** 落ちていたときに打つ手 */
  action: string;
};

export type StageFlow = {
  stages: Stage[];
  /** stages[i-1] → stages[i] の転換率。null は算出不能 */
  transitions: (number | null)[];
  /** 最大ドロップの段 index。null は判定不可 */
  biggestDropIndex: number | null;
  /** 転換率を出せた区間の数。1以下なら落ち込みの比較はできない */
  comparableSegments: number;
};

/** 最大ドロップを名指しするのに必要な、算出できた区間の数 */
const MIN_SEGMENTS_FOR_DROP = 2;

export function buildFlow(stages: Stage[]): StageFlow {
  const transitions: (number | null)[] = [null];
  let biggestDropIndex: number | null = null;
  let worst = Infinity;
  let comparable = 0;

  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1].value;
    const cur = stages[i].value;
    // ★どちらかが未計測なら率を出さない。0除算も避ける（§16.5）
    if (prev !== null && cur !== null && prev > 0) {
      const r = cur / prev;
      transitions.push(r);
      comparable += 1;
      if (r < worst) {
        worst = r;
        biggestDropIndex = i;
      }
    } else {
      transitions.push(null);
    }
  }

  return {
    stages,
    transitions,
    biggestDropIndex: comparable >= MIN_SEGMENTS_FOR_DROP ? biggestDropIndex : null,
    comparableSegments: comparable,
  };
}
