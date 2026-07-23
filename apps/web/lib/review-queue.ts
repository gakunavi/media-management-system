// リライト督促（設計書 §7.5.2）
//
// ★二段構えにする理由（cowork 実運用ヒアリング 2026-07-23）
//   処理能力は**週2〜3本**。期限切れを全部赤で出すと、件数が能力を超えた瞬間に
//   誰も見なくなる。期限は「督促を出す境界」に留め、
//   **実着手は CTR不全（順位10〜25位・表示あり・クリック0）と重なった記事**を先に出す。
//   実際、intervention 9件の着手理由の最多がこの形だった。
//
// ★「効いた/効かなかった」も実測がある（cowork）
//   効いた   : 読者意図に合わせた即答型タイトル/メタ（ART-101 クリック4→7・表示203→509）
//   効かない : キーワード列挙型のタイトル追加（ART-061 24.7位→10.3位だがクリック0のまま）
//   → 督促に「何をするか」を添えないと、順位だけ動いてクリックが増えない作業になる。
//
// ★基準日が無い記事を overdue にしない（§3）
//   「期限が未定」と「今すぐ見直すべき」は別物。
import { prisma } from "@mms/db";
import { decodeEntities } from "./content";
import { getCtrFailures, type CtrFailure } from "./search-queries";

export const FRESHNESS_LABEL: Record<string, string> = {
  breaking: "速報",
  commercial: "商材・比較",
  evergreen: "Pillar・実務",
  reference: "制度・リスク",
};

export type ReviewRow = {
  externalId: string;
  title: string;
  freshnessTier: string | null;
  reviewState: string;
  nextReviewDue: Date | null;
  daysOver: number | null;
  /** CTR不全の根拠。ある記事を先に出す */
  ctrFail: CtrFailure | null;
};

export type ReviewQueue = {
  /** 期限切れ＋CTR不全 の両方に当たる。ここから着手する */
  priority: ReviewRow[];
  /** 期限切れだが CTR不全ではない */
  overdue: ReviewRow[];
  /** まもなく期限 */
  dueSoon: ReviewRow[];
  /** 期限は先だが CTR不全。期限を待たずに直す価値がある */
  ctrOnly: ReviewRow[];
  /** 基準日が無く期限を計算できない（未計測ではなく未入力） */
  noBaseline: number;
  /** 週あたりの処理能力（cowork 実績） */
  weeklyCapacity: number;
};

export const WEEKLY_CAPACITY = 3;

export async function getReviewQueue(): Promise<ReviewQueue> {
  const [items, ctr] = await Promise.all([
    prisma.contentItem.findMany({
      where: { type: { in: ["article", "article_unlinked"] } },
      select: {
        id: true,
        externalId: true,
        title: true,
        freshnessTier: true,
        reviewState: true,
        nextReviewDue: true,
        lastReviewedAt: true,
      },
    }),
    getCtrFailures(),
  ]);

  const today = new Date();
  const toRow = (i: (typeof items)[number]): ReviewRow => ({
    externalId: i.externalId,
    title: decodeEntities(i.title),
    freshnessTier: i.freshnessTier,
    reviewState: i.reviewState,
    nextReviewDue: i.nextReviewDue,
    daysOver: i.nextReviewDue
      ? Math.floor((today.getTime() - i.nextReviewDue.getTime()) / 86400000)
      : null,
    ctrFail: ctr.get(i.id) ?? null,
  });

  const priority: ReviewRow[] = [];
  const overdue: ReviewRow[] = [];
  const dueSoon: ReviewRow[] = [];
  const ctrOnly: ReviewRow[] = [];
  let noBaseline = 0;

  for (const i of items) {
    const r = toRow(i);
    if (i.lastReviewedAt === null && i.freshnessTier !== null) noBaseline += 1;
    if (i.reviewState === "overdue") {
      (r.ctrFail ? priority : overdue).push(r);
    } else if (i.reviewState === "due_soon") {
      dueSoon.push(r);
    } else if (r.ctrFail) {
      ctrOnly.push(r);
    }
  }

  // 表示の多い順＝取り逃している需要の大きい順
  const byImpr = (a: ReviewRow, b: ReviewRow) =>
    (b.ctrFail?.impressions ?? 0) - (a.ctrFail?.impressions ?? 0);
  priority.sort(byImpr);
  ctrOnly.sort(byImpr);
  overdue.sort((a, b) => (b.daysOver ?? 0) - (a.daysOver ?? 0));
  dueSoon.sort((a, b) => (a.daysOver ?? 0) - (b.daysOver ?? 0));

  return { priority, overdue, dueSoon, ctrOnly, noBaseline, weeklyCapacity: WEEKLY_CAPACITY };
}
