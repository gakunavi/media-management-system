"use server";

// 段5「次の一手」の承認/却下/差戻し ＋ 立案の実行（設計書 §5.2 / §5.3 / §5.6）
import { revalidatePath } from "next/cache";
import { prisma, type Prisma } from "@mms/db";
import { currentUser } from "@/lib/session";
import { generateProposals, JUDGE_DAYS } from "@/lib/operator";

const DAY = 86400000;

type Result = { ok: true; message: string } | { ok: false; error: string };

async function requireOwner(): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  // ★auth() を直接使わない。localhost の自動ログインでは Cookie 名が違い、
  //   auth() が常に null を返して owner 限定の操作が全部落ちる（lib/session.ts）
  const user = await currentUser();
  if (user?.role !== "owner") {
    return { ok: false, error: "権限がありません（owner のみ）" };
  }
  return { ok: true, id: user.id };
}

/** 立案を実行（§5.1 週次。手動トリガーとしても使える） */
export async function runOperator(): Promise<Result> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  const { created, scanned } = await generateProposals();
  revalidatePath("/experiments");
  revalidatePath("/");
  return {
    ok: true,
    message:
      created > 0
        ? `立案完了: ${created}件を新規起票（候補 ${scanned}件）`
        : `新規の起票はありませんでした（候補 ${scanned}件は既出）`,
  };
}

function readArtifact(a: unknown): { contentItemId: string | null; evaluateDays: number | null } {
  if (a && typeof a === "object") {
    const o = a as Record<string, unknown>;
    return {
      contentItemId: typeof o.contentItemId === "string" ? o.contentItemId : null,
      evaluateDays: typeof o.evaluateDays === "number" ? o.evaluateDays : null,
    };
  }
  return { contentItemId: null, evaluateDays: null };
}

/**
 * 承認（§5.2）: Action を approved にし、Intervention を生成して判定日を予約する。
 *   baseline に適用前28日の実測を記録（§5.3 の netEffect 計算の起点）。
 */
export async function approveAction(actionId: string): Promise<Result> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;

  const action = await prisma.action.findUnique({ where: { id: actionId } });
  if (!action) return { ok: false, error: "Action が見つかりません" };
  if (action.state !== "proposed" && action.state !== "awaiting_approval") {
    return { ok: false, error: `この状態では承認できません（${action.state}）` };
  }

  const art = readArtifact(action.preparedArtifact);
  const now = new Date();
  const evaluateDays = art.evaluateDays ?? JUDGE_DAYS[action.type] ?? 28;
  const evaluateAt = new Date(now.getTime() + evaluateDays * DAY);

  // 適用前28日の baseline（対象記事の clicks/impressions/position）
  let baseline: Prisma.InputJsonValue = {};
  if (art.contentItemId) {
    const since = new Date(now.getTime() - 28 * DAY);
    const agg = await prisma.contentMetric.groupBy({
      by: ["metric"],
      where: {
        contentItemId: art.contentItemId,
        metric: { in: ["clicks", "impressions", "position"] },
        date: { gte: since },
      },
      _sum: { value: true },
      _avg: { value: true },
    });
    const b: Record<string, number> = {};
    for (const r of agg) {
      b[r.metric] =
        r.metric === "position"
          ? Math.round((r._avg.value ?? 0) * 10) / 10
          : Math.round(r._sum.value ?? 0);
    }
    baseline = { window: "prev28d", ...b };
  }

  await prisma.$transaction([
    prisma.action.update({ where: { id: actionId }, data: { state: "approved" } }),
    prisma.actionEvent.create({
      data: { actionId, event: "approved", actorId: gate.id, at: now },
    }),
    prisma.intervention.create({
      data: {
        actionId,
        contentItemId: art.contentItemId,
        type: action.type,
        appliedAt: now,
        evaluateAt,
        baseline,
        verdict: "pending",
      },
    }),
  ]);

  revalidatePath("/experiments");
  revalidatePath("/");
  return {
    ok: true,
    message: `承認しました。${evaluateDays}日後（${evaluateAt.toLocaleDateString("ja-JP")}）に効果を自動判定します`,
  };
}

/**
 * 却下（§5.6）: 却下理由を ActionEvent に残す。これが次回の立案の学習データになる。
 */
export async function rejectAction(actionId: string, reason: string): Promise<Result> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;
  if (!reason.trim()) return { ok: false, error: "却下理由は必須です（学習データになります）" };

  const action = await prisma.action.findUnique({ where: { id: actionId }, select: { state: true } });
  if (!action) return { ok: false, error: "Action が見つかりません" };

  await prisma.$transaction([
    prisma.action.update({ where: { id: actionId }, data: { state: "rejected" } }),
    prisma.actionEvent.create({
      data: { actionId, event: "rejected", reason: reason.trim(), actorId: gate.id, at: new Date() },
    }),
  ]);

  revalidatePath("/experiments");
  revalidatePath("/");
  return { ok: true, message: "却下しました。理由は次回の立案に反映されます（§5.6）" };
}

/**
 * 石井さんが自分で行った施策を記録する（§5.3 判定は同じ経路に乗せる）。
 *
 * ★なぜ要るか
 *   MMS は「システムが立案 → 承認」のときだけ Intervention を作っていた。
 *   だが実際の施策の多くは人が主導している（ART-061 の令和8年度改正対応、
 *   ART-142 の統合と301、orphan42→4 の内部リンク注入 など）。
 *   これらは cowork の intervention-record.py が timeseries.db に記録していたが、
 *   MMS を正にする以上ここで受けないと、記録そのものが止まる。
 *   分岐させるのではなく、入口を MMS に移す。
 *
 * ★Action を必ず伴わせる（Intervention.actionId は必須）。
 *   proposedBy="石井（手動記録）" / state=approved で、立案経由と区別できる形で残す。
 *
 * ★baseline は承認経路と同じ「適用前28日の実測」を取る。
 *   ここを省くと 28日後の自動判定が netEffect を出せない。
 */
export async function recordManualIntervention(input: {
  /** THR-xxx / ART-xxx など ContentItem.externalId */
  externalId: string;
  type: string;
  /** "YYYY-MM-DD"（JST）。未来日は受け付けない */
  appliedAt: string;
  note: string;
}): Promise<Result> {
  const gate = await requireOwner();
  if (!gate.ok) return gate;

  const externalId = input.externalId.trim();
  const note = input.note.trim();
  if (!externalId) return { ok: false, error: "対象の記事ID（ART-xxx）は必須です" };
  if (!note) return { ok: false, error: "何をしたかの記録は必須です（後で効果を読む材料になります）" };

  const item = await prisma.contentItem.findFirst({
    where: { externalId },
    select: { id: true, title: true, channel: { select: { businessId: true } } },
  });
  if (!item) return { ok: false, error: `${externalId} が見つかりません` };

  const applied = new Date(`${input.appliedAt}T00:00:00+09:00`);
  if (Number.isNaN(applied.getTime())) return { ok: false, error: "実施日の形式が不正です" };
  const now = new Date();
  if (applied.getTime() > now.getTime()) {
    // ★未来日を許すと、baseline が「まだ起きていない期間」になり判定が壊れる
    return { ok: false, error: "実施日に未来の日付は指定できません" };
  }

  const type = (input.type || "rewrite").trim();
  const evaluateDays = JUDGE_DAYS[type as keyof typeof JUDGE_DAYS] ?? 28;
  const evaluateAt = new Date(applied.getTime() + evaluateDays * DAY);

  // 適用前28日の実測（承認経路と同じ取り方）
  const since = new Date(applied.getTime() - 28 * DAY);
  const agg = await prisma.contentMetric.groupBy({
    by: ["metric"],
    where: {
      contentItemId: item.id,
      metric: { in: ["clicks", "impressions", "position"] },
      date: { gte: since, lt: applied },
    },
    _sum: { value: true },
    _avg: { value: true },
  });
  const b: Record<string, number> = {};
  for (const r of agg) {
    b[r.metric] =
      r.metric === "position"
        ? Math.round((r._avg.value ?? 0) * 10) / 10
        : Math.round(r._sum.value ?? 0);
  }
  const baseline = { window: "prev28d", ...b } as Prisma.InputJsonValue;
  // ★適用前の実測が1行も無いと 28日後に netEffect を計算できない。
  //   記録は受けるが「判定できる見込みが無い」ことをその場で伝える。
  //   黙って受けると、28日後に inconclusive が出て理由が分からなくなる。
  const noBaseline = agg.length === 0;

  const businessId = item.channel?.businessId;
  if (!businessId) return { ok: false, error: "Business を特定できませんでした" };

  await prisma.$transaction(async (tx) => {
    const action = await tx.action.create({
      data: {
        businessId,
        // ★ActionType に無い値は弾かれる。UI 側で選ばせる
        type: type as never,
        title: `${externalId} ${note.slice(0, 40)}`,
        rationale: note,
        impacts: ["clicks"],
        proposedBy: "石井（手動記録）",
        state: "approved",
      },
    });
    await tx.actionEvent.create({
      data: { actionId: action.id, event: "approved", actorId: gate.id, at: applied },
    });
    await tx.intervention.create({
      data: {
        actionId: action.id,
        contentItemId: item.id,
        type,
        appliedAt: applied,
        evaluateAt,
        baseline,
        verdict: "pending",
      },
    });
  });

  revalidatePath("/experiments");
  revalidatePath("/");
  return {
    ok: true,
    message: noBaseline
      ? `記録しました。ただし ${externalId} は適用前28日の実測が1件も無く、このままでは ${evaluateAt.toLocaleDateString("ja-JP")} の判定が inconclusive になります（GSCに現れていない記事です）`
      : `記録しました。${evaluateAt.toLocaleDateString("ja-JP")} に効果を自動判定します（適用前28日: clicks ${b.clicks ?? 0} / 掲載順位 ${b.position ?? "—"}）`,
  };
}
