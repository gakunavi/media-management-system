// リード一覧・集計（設計書 §14.3 / §4.2 /leads）
//
// ★個人情報は decryptIfEncrypted → maskContact で必ずマスキングして返す（§16.2）。
//   生の氏名・連絡先を画面やログに出さない。
import { prisma, type Prisma } from "@mms/db";
import { decryptIfEncrypted, maskContact } from "./crypto";

export type LeadListRow = {
  id: string;
  type: string;
  status: string;
  sourceType: string;
  budgetTier: string;
  occurredAt: Date;
  firstResponseAt: Date | null;
  interestProduct: string[];
  competitorsConsidered: string[];
  companyMasked: string;
  contactMasked: string;
  firstTouchExternalId: string | null;
  closedAmount: string | null; // Decimal → 文字列
  note: string | null;
};

/** 初動速度（分）。null=未対応 */
export function firstResponseMinutes(row: {
  occurredAt: Date;
  firstResponseAt: Date | null;
}): number | null {
  if (!row.firstResponseAt) return null;
  return Math.round((row.firstResponseAt.getTime() - row.occurredAt.getTime()) / 60000);
}

export async function getLeads(): Promise<LeadListRow[]> {
  const rows = await prisma.lead.findMany({
    orderBy: { occurredAt: "desc" },
    include: { firstTouchContent: { select: { externalId: true } } },
  });

  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    sourceType: r.sourceType,
    budgetTier: r.budgetTier,
    occurredAt: r.occurredAt,
    firstResponseAt: r.firstResponseAt,
    interestProduct: r.interestProduct,
    competitorsConsidered: r.competitorsConsidered,
    // ★復号 → マスキング。生値は返さない
    companyMasked: maskContact(decryptIfEncrypted(r.companyName)),
    contactMasked: maskContact(
      decryptIfEncrypted(r.contactEmail) ?? decryptIfEncrypted(r.contactPhone),
    ),
    firstTouchExternalId: r.firstTouchContent?.externalId ?? null,
    closedAmount: r.closedAmount ? r.closedAmount.toString() : null,
    note: r.note ? decryptIfEncrypted(r.note) : null,
  }));
}

export type LeadStats = {
  byType: Record<string, number>;
  won: number;
  wonAmount: number;
  /** 経路特定率（§1.1 成功指標1）: firstTouch か phone_manual が入っている割合 */
  pathIdentifiedRate: number | null;
  total: number;
};

export async function getLeadStats(): Promise<LeadStats> {
  const rows = await prisma.lead.findMany({
    select: {
      type: true,
      status: true,
      closedAmount: true,
      firstTouchContentId: true,
      sourceType: true,
    },
  });

  const byType: Record<string, number> = {};
  let won = 0;
  let wonAmount = 0;
  let pathIdentified = 0;
  for (const r of rows) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
    if (r.status === "won") {
      won += 1;
      wonAmount += r.closedAmount ? Number(r.closedAmount) : 0;
    }
    if (r.firstTouchContentId || r.sourceType === "phone_manual") pathIdentified += 1;
  }

  return {
    byType,
    won,
    wonAmount,
    pathIdentifiedRate: rows.length ? pathIdentified / rows.length : null,
    total: rows.length,
  };
}

export const LEAD_TYPE_LABEL: Record<string, string> = {
  direct_inquiry: "直客",
  agency: "代理店",
  line_friend: "LINE",
};

export const LEAD_STATUS_LABEL: Record<string, string> = {
  new: "新規",
  contacted: "初動済",
  qualified: "見込あり",
  proposal: "提案中",
  won: "成約",
  lost: "失注",
};

export const SOURCE_TYPE_LABEL: Record<string, string> = {
  form: "フォーム",
  phone_manual: "電話（手動）",
  line: "LINE",
  threads_dm: "Threads DM",
};

export const BUDGET_TIER_LABEL: Record<string, string> = {
  high: "高（1,000万〜）",
  mid: "中（300〜1,000万）",
  low: "低（〜300万）",
  unknown: "不明",
};

export type LeadFilter = Prisma.LeadWhereInput;

// ── 公式LINE の数値（PDCA用・設計書 §4.1 段1 ③）────────────────────
//
// ★MMS が LINE について持つのは「数」だけ。会話の中身は LINE 公式アカウント側にある。
//   ここで見たいのは 登録者数 → 問い合わせ数 → 成約数 → 金額 の落ち方。
//
// ★2026-07-22 の経緯: 購入検討中の方から2件の問い合わせが来ていたが
//   誰も気づいていなかった。MMS は公式LINEを未計測として扱っていた。

export type LineStats = {
  /** 友だち登録の累計（LineFriend） */
  friends: number;
  /** 期間内の登録数 */
  friendsInPeriod: number;
  /**
   * 期間内に届いたメッセージ件数。
   * ★これは「問い合わせ数」ではない。スタンプや「こんにちは」も1件に数える。
   */
  inbounds: number;
  /**
   * 問い合わせ数。Lead(sourceType=line) の件数。
   * ★受信メッセージのうち「商談になりうるもの」だけを人が起票する。
   *   全受信を問い合わせと呼ぶと、PDCA の分母が実態より大きくなる。
   */
  inquiries: number;
  /** 未対応のメッセージ件数。見落としの検知 */
  unhandled: number;
  /** LINE 経由のリードのうち成約したもの */
  won: number;
  wonAmount: number;
  /** 登録 → 問い合わせ の転換率。母数が無ければ null（§16.5） */
  inquiryRate: number | null;
  /** 問い合わせ → 成約 の転換率 */
  closeRate: number | null;
  /** 計測が始まっているか。false は 0 ではなく未計測（§3） */
  measured: boolean;
  days: number;
  daily: { date: string; value: number | null }[];

  /**
   * Threads から公式LINEへ送ったクリック数（期間内）。
   *
   * ★LINE の follow イベントには経路情報が入らない（LINE の仕様）。
   *   「どの投稿がLINE登録を生んだか」は原理的に取れないので、
   *   送客クリック数で近似する。登録数と並べて初めて意味を持つ:
   *     クリック 40 → 登録 8  なら「送った人の2割が登録」
   *   投稿別の内訳は /threads の「→LINE」列にある。
   */
  threadsClicks: number;
  /** クリック → 登録 の到達率。どちらかが0なら null（§16.5） */
  followPerClick: number | null;
};

export async function getLineStats(days = 30, now: Date = new Date()): Promise<LineStats> {
  const since = new Date(now.getTime() - days * 86400000);

  const [friends, friendsInPeriod, inboundRows, unhandled, leads, coverage, clickAgg] =
    await Promise.all([
    prisma.lineFriend.count(),
    prisma.lineFriend.count({ where: { addedAt: { gte: since } } }),
    prisma.lineInbound.findMany({
      where: { receivedAt: { gte: since } },
      select: { receivedAt: true },
    }),
    prisma.lineInbound.count({ where: { handledAt: null } }),
    prisma.lead.findMany({
      where: { sourceType: "line" },
      select: { status: true, closedAmount: true },
    }),
    prisma.measurementCoverage.findFirst({ where: { metric: "lead_line" }, select: { id: true } }),
    prisma.contentMetric.aggregate({
      _sum: { value: true },
      where: { metric: "threads_link_clicks_line", date: { gte: since } },
    }),
  ]);

  let won = 0;
  let wonAmount = 0;
  for (const l of leads) {
    if (l.status === "won") {
      won += 1;
      wonAmount += l.closedAmount ? Number(l.closedAmount) : 0;
    }
  }

  const inbounds = inboundRows.length;
  const inquiries = leads.length;
  const byDay = new Map<string, number>();
  for (const r of inboundRows) {
    const k = new Date(r.receivedAt.getTime() + 9 * 3600000).toISOString().slice(0, 10);
    byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }
  const daily: { date: string; value: number | null }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = new Date(now.getTime() - i * 86400000 + 9 * 3600000).toISOString().slice(0, 10);
    daily.push({ date: k, value: byDay.get(k) ?? 0 });
  }

  const threadsClicks = Math.round(clickAgg._sum.value ?? 0);

  return {
    friends,
    friendsInPeriod,
    threadsClicks,
    // ★分母0で率を出さない。送客していないのに「到達率0%」は誤り
    followPerClick: threadsClicks > 0 ? friendsInPeriod / threadsClicks : null,
    inbounds,
    inquiries,
    unhandled,
    won,
    wonAmount,
    // ★母数0で率を出さない。0% と「まだ分からない」は違う（§16.5）
    // ★分母は「登録者数」、分子は「問い合わせとして起票された数」。
    //   受信メッセージ数を分子にすると、スタンプ1つで転換率が上がる
    inquiryRate: friends > 0 ? inquiries / friends : null,
    closeRate: inquiries > 0 ? won / inquiries : null,
    measured: Boolean(coverage),
    days,
    daily,
  };
}
