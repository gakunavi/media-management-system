// 実行済みの打ち手＝Intervention の一覧（設計書 §5.3 Check）
//
// ★なぜ「判定できるか」を判定日より前に出すか（2026-07-24）
//   判定は「適用後28日 − 適用前28日 − 対照群」で出すが、**実測が無ければ
//   何をしても inconclusive にしかならない**。しかもそれが分かるのは判定日当日で、
//   その時点ではもう打つ手が無い。
//
//   実測（2026-07-24）で pending 7件のうち2件が既に判定不能確定だった:
//     ART-142  301ループで検索結果から消え、実測が 6/20 で停止（後28日が0日）
//     ART-090  直近90日で検索表示が1件も無く、実測が 6/21 で停止
//   前者はループを直したので**判定日を延ばせば測れる**。後者は延ばしても測れない。
//   この区別を判定日の前に出せば、延期するか諦めるかを選べる。
//
// ★実測の「0日」と「値が0」を混同しない（§3）。日数で持つ。
import { prisma } from "@mms/db";

/** 判定に使う主指標（lib/evaluate.ts の primaryMetric と揃える） */
function primaryMetricOf(type: string): string {
  if (type.includes("title") || type.includes("meta")) return "clicks";
  if (type.includes("cta") || type.includes("link")) return "clicks";
  return "clicks";
}

export type InterventionRow = {
  id: string;
  type: string;
  appliedAt: Date;
  evaluateAt: Date;
  verdict: string;
  contentExternalId: string | null;
  contentTitle: string | null;
  /** 判定期日を過ぎているか */
  due: boolean;
  /** 判定日まで何日か（過ぎていれば負） */
  daysLeft: number;
  /** 適用前28日に実測があった日数 */
  preDays: number;
  /** 適用〜判定日に実測があった日数 */
  postDays: number;
  /**
   * このままだと判定できない。
   * ★判定日を待たずに分かる。分かれば延期するか諦めるかを選べる
   */
  willBeInconclusive: boolean;
  /** 判定済みのとき、実際に何がどう変わったか */
  netEffect: number | null;
  confidence: string | null;
  /** 判定の理由（inconclusive の理由など） */
  reason: string | null;
  /**
   * 延期の履歴。
   * ★何回・なぜ延ばしたかが見えないと、都合の悪い判定の先送りに気づけない
   */
  postponed: { from: string; to: string; reason: string }[];
};

export async function getInterventions(): Promise<InterventionRow[]> {
  const rows = await prisma.intervention.findMany({
    orderBy: { appliedAt: "desc" },
    include: { contentItem: { select: { id: true, externalId: true, title: true } } },
  });

  const now = Date.now();
  const DAY = 86400000;

  return Promise.all(
    rows.map(async (r) => {
      const metric = primaryMetricOf(r.type);
      let preDays = 0;
      let postDays = 0;
      if (r.contentItem) {
        const [pre, post] = await Promise.all([
          prisma.contentMetric.count({
            where: {
              contentItemId: r.contentItem.id,
              metric,
              date: {
                gte: new Date(r.appliedAt.getTime() - 28 * DAY),
                lt: r.appliedAt,
              },
            },
          }),
          prisma.contentMetric.count({
            where: {
              contentItemId: r.contentItem.id,
              metric,
              date: { gte: r.appliedAt, lte: r.evaluateAt },
            },
          }),
        ]);
        preDays = pre;
        postDays = post;
      }

      const result = (r.result ?? {}) as Record<string, unknown>;
      return {
        id: r.id,
        type: r.type,
        appliedAt: r.appliedAt,
        evaluateAt: r.evaluateAt,
        verdict: r.verdict,
        contentExternalId: r.contentItem?.externalId ?? null,
        contentTitle: r.contentItem?.title ?? null,
        due: r.evaluateAt.getTime() <= now,
        daysLeft: Math.ceil((r.evaluateAt.getTime() - now) / DAY),
        preDays,
        postDays,
        // ★判定日を過ぎていなくても、実測が片側でも欠けていれば結果は決まっている
        willBeInconclusive:
          r.verdict === "pending" && (!r.contentItem || preDays === 0 || postDays === 0),
        netEffect: r.netEffect,
        confidence: r.confidence,
        reason: typeof result.reason === "string" ? result.reason : null,
        postponed: Array.isArray(result.postponed)
          ? (result.postponed as { from: string; to: string; reason: string }[])
          : [],
      };
    }),
  );
}

/**
 * 判定日を延ばす。
 *
 * ★なぜ要るか
 *   前提が壊れていた打ち手は、そのまま判定すると**嘘の学習**が残る。
 *   実測: ART-142 は統合の効果を測るはずが、301ループで記事に到達できず
 *   検索結果から消えていた。これを「効果なし」と判定すると
 *   「統合は効かない」という誤った学習になる。ループは 2026-07-24 に直ったので、
 *   そこから28日測り直すのが正しい。
 * ★理由を必須にする。理由なく延ばせると、都合の悪い判定を永久に先送りできる。
 */
export async function postponeIntervention(
  id: string,
  newEvaluateAt: Date,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const iv = await prisma.intervention.findUnique({
    where: { id },
    select: { verdict: true, evaluateAt: true, result: true },
  });
  if (!iv) return { ok: false, error: "見つかりません" };
  if (iv.verdict !== "pending") {
    return { ok: false, error: "判定済みのものは延期できません" };
  }
  if (newEvaluateAt.getTime() <= iv.evaluateAt.getTime()) {
    return { ok: false, error: "いまの判定日より後の日付を指定してください" };
  }
  const prev = (iv.result ?? {}) as Record<string, unknown>;
  const history = Array.isArray(prev.postponed) ? prev.postponed : [];
  await prisma.intervention.update({
    where: { id },
    data: {
      evaluateAt: newEvaluateAt,
      // ★延期の履歴を残す。何回延ばしたかが見えないと、先送りに気づけない
      result: {
        ...prev,
        postponed: [
          ...history,
          { from: iv.evaluateAt.toISOString(), to: newEvaluateAt.toISOString(), reason },
        ],
      },
    },
  });
  return { ok: true };
}
