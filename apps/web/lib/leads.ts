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
