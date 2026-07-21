// 効果判定（設計書 §5.3 Check・§16.5 判定の信頼度）
//
//   netEffect = (適用後28日の実測) − (適用前28日の実測) − (対照群の同期間トレンド)
//   対照群 = 同カテゴリで、その期間に手を入れていない記事群
//
// ★対照群補正が無いと「季節変動で上がっただけ」を「施策が効いた」と誤判定する。
// ★§16.5: 対照群が 5記事未満 or 合計impressions 500未満なら inconclusive。
//   「効果なし(neutral)」とは別物として扱う。
import { prisma, type Prisma } from "@mms/db";

const DAY = 86400000;

/** 打ち手タイプ → 主に見る指標（docs/GLOSSARY.md §5.1「効く指標」） */
function primaryMetric(type: string): "clicks" | "position" {
  return type === "kw_pivot" ? "position" : "clicks";
}

type Window = { from: Date; to: Date };

async function sumMetric(
  contentItemId: string,
  metric: string,
  w: Window,
): Promise<{ value: number; days: number }> {
  const rows = await prisma.contentMetric.findMany({
    where: { contentItemId, metric, date: { gte: w.from, lte: w.to } },
    select: { value: true },
  });
  if (rows.length === 0) return { value: 0, days: 0 };
  const total = rows.reduce((a, r) => a + r.value, 0);
  // position は平均、それ以外は合計
  return {
    value: metric === "position" ? total / rows.length : total,
    days: rows.length,
  };
}

export type EvaluateResult = {
  evaluated: number;
  byVerdict: Record<string, number>;
  skippedNoData: number;
};

/**
 * 判定期日を迎えた Intervention を自動判定する（§5.1 日次ジョブ）。
 */
export async function evaluateDueInterventions(now = new Date()): Promise<EvaluateResult> {
  const due = await prisma.intervention.findMany({
    where: { verdict: "pending", evaluateAt: { lte: now } },
    include: { contentItem: { select: { id: true, category: true } } },
  });

  const byVerdict: Record<string, number> = {};
  let evaluated = 0;
  let skippedNoData = 0;

  for (const iv of due) {
    if (!iv.contentItemId || !iv.contentItem) {
      // 対象記事が無い打ち手は判定できない
      await setVerdict(iv.id, "inconclusive", {
        reason: "対象記事が紐付いていないため判定できない",
      });
      byVerdict.inconclusive = (byVerdict.inconclusive ?? 0) + 1;
      evaluated += 1;
      continue;
    }

    const metric = primaryMetric(iv.type);
    const post: Window = { from: iv.appliedAt, to: iv.evaluateAt };
    const pre: Window = {
      from: new Date(iv.appliedAt.getTime() - 28 * DAY),
      to: new Date(iv.appliedAt.getTime() - 1),
    };

    const [postVal, preVal] = await Promise.all([
      sumMetric(iv.contentItemId, metric, post),
      sumMetric(iv.contentItemId, metric, pre),
    ]);

    // 実測が片側でも無ければ判定不能（★0と欠測を混同しない・§3 規約）
    if (postVal.days === 0 || preVal.days === 0) {
      await setVerdict(iv.id, "inconclusive", {
        reason: "適用前後どちらかの実測が無い（欠測）。0ではなく未計測として扱う",
        metric,
        postDays: postVal.days,
        preDays: preVal.days,
      });
      byVerdict.inconclusive = (byVerdict.inconclusive ?? 0) + 1;
      evaluated += 1;
      skippedNoData += 1;
      continue;
    }

    // ── 対照群（同カテゴリ・期間中に手を入れていない記事）──
    const touched = await prisma.intervention.findMany({
      where: {
        id: { not: iv.id },
        appliedAt: { lte: iv.evaluateAt },
        evaluateAt: { gte: iv.appliedAt },
        contentItemId: { not: null },
      },
      select: { contentItemId: true },
    });
    const touchedIds = new Set(
      touched.map((t) => t.contentItemId).filter((v): v is string => v !== null),
    );
    touchedIds.add(iv.contentItemId);

    const controls = await prisma.contentItem.findMany({
      where: {
        type: "article",
        category: iv.contentItem.category,
        id: { notIn: [...touchedIds] },
      },
      select: { id: true },
    });

    let controlDeltaSum = 0;
    let controlCount = 0;
    let controlImpressions = 0;
    for (const c of controls) {
      const [cPost, cPre, cImpr] = await Promise.all([
        sumMetric(c.id, metric, post),
        sumMetric(c.id, metric, pre),
        sumMetric(c.id, "impressions", post),
      ]);
      if (cPost.days === 0 || cPre.days === 0) continue;
      controlDeltaSum += cPost.value - cPre.value;
      controlCount += 1;
      controlImpressions += cImpr.value;
    }

    const controlDelta = controlCount > 0 ? controlDeltaSum / controlCount : 0;
    const rawDelta = postVal.value - preVal.value;
    // position は小さいほど良いので符号を反転して「改善量」に揃える
    const sign = metric === "position" ? -1 : 1;
    const netEffect = Math.round((sign * (rawDelta - controlDelta)) * 100) / 100;

    // §16.5 最小サンプル基準
    const enough = controlCount >= 5 && controlImpressions >= 500;
    const confidence = enough ? "high" : controlCount > 0 ? "low" : "low";

    let verdict: string;
    if (!enough) {
      // ★基準未満は「効果なし」ではなく「判定不能」（§16.5）
      verdict = "inconclusive";
    } else if (netEffect > 0.5) {
      verdict = "positive";
    } else if (netEffect < -0.5) {
      verdict = "negative";
    } else {
      verdict = "neutral";
    }

    await prisma.intervention.update({
      where: { id: iv.id },
      data: {
        result: { window: "post28d", metric, value: Math.round(postVal.value * 10) / 10 },
        controlDelta: Math.round(controlDelta * 100) / 100,
        netEffect,
        verdict: verdict as Prisma.InterventionUpdateInput["verdict"],
        controlGroupSize: controlCount,
        confidence,
      },
    });

    // §5.3: 判定から Learning を自動生成
    await prisma.learning.create({
      data: {
        interventionId: iv.id,
        at: now,
        body:
          `[${iv.type}] ${metric} の netEffect ${netEffect >= 0 ? "+" : ""}${netEffect}` +
          `（適用前 ${Math.round(preVal.value * 10) / 10} → 適用後 ${Math.round(postVal.value * 10) / 10}、` +
          `対照群トレンド ${Math.round(controlDelta * 100) / 100}、対照群 ${controlCount}記事）。` +
          `判定: ${verdict}／信頼度: ${confidence}` +
          (enough ? "" : "（★対照群が §16.5 の最小基準 5記事・500impressions 未満のため判定不能）"),
      },
    });

    byVerdict[verdict] = (byVerdict[verdict] ?? 0) + 1;
    evaluated += 1;
  }

  return { evaluated, byVerdict, skippedNoData };
}

async function setVerdict(
  id: string,
  verdict: string,
  note: Record<string, unknown>,
): Promise<void> {
  await prisma.intervention.update({
    where: { id },
    data: {
      verdict: verdict as Prisma.InterventionUpdateInput["verdict"],
      result: note as Prisma.InputJsonValue,
      confidence: "low",
    },
  });
}
