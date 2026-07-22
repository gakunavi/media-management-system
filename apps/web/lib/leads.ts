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

// ── 経路別のリード実績（設計書 §3.8.3 Lead.sourceType）────────────────
//
// ★これが本来の見せ方。以前は「直客/代理店/LINE」（＝ゴールの種類）しか
//   出しておらず、経路（どこから来たか）を一度も画面に出していなかった。
//   さらに LINE だけ専用パネルを作っており、経路の1つを特別扱いしていた。
//
// ★経路ごとに「件数 → 成約 → 金額」を並べ、最後に合計を出す。
//   どの経路が獲得に効いているかは、この並びでしか判断できない。

export const SOURCE_LABEL: Record<string, string> = {
  form: "HPの問い合わせ",
  lp_diagnosis: "診断LP",
  lp_agency: "代理店LP",
  line: "公式LINE",
  threads_dm: "Threads DM",
  phone_manual: "電話",
  email: "info メール直接",
  lp_form: "LP（旧・未分類）",
};

/**
 * 受け皿の表示順（2026-07-22 石井さんと整理）。
 * ★lp_form は診断LPと代理店LPを区別できない旧値。残っている行があるときだけ出す。
 */
export const SOURCE_ORDER = [
  "form",
  "lp_diagnosis",
  "lp_agency",
  "line",
  "threads_dm",
  "phone_manual",
  "email",
];

export type SourceRow = {
  key: string;
  label: string;
  /** リード件数 */
  leads: number;
  /** 成約数 */
  won: number;
  /** 成約金額 */
  wonAmount: number;
  /** 成約率。母数0なら null（§16.5） */
  closeRate: number | null;
  /** 未対応（初回応答が未記録）の件数。見落としの検知 */
  unresponded: number;
  /** その経路の計測が始まっているか。false は 0 ではなく未計測（§3） */
  measured: boolean;
};

export type SourceBreakdown = {
  rows: SourceRow[];
  total: SourceRow;
  /**
   * 公式LINEの友だち数。
   * ★null は未計測。MMS が数えられるのは Webhook 設置（2026-07-22）以降の
   *   follow だけで、それ以前の友だちは観測していない。0 と書くと
   *   「友だちがいない」という誤った像になる。
   *   実数は Messaging API の insight/followers で取れるが、
   *   チャネルアクセストークンが必要（未設定）。
   */
  lineFriends: number | null;
  /** Threads から公式LINEへ送ったクリック数（経路の近似・直近30日） */
  threadsToLineClicks: number;
  days: number;
};

/** その経路の計測が始まっているか。MeasurementCoverage の metric 名 */
const SOURCE_COVERAGE: Record<string, string> = {
  form: "lead_direct_inquiry",
  lp_diagnosis: "lp_form_submit_b",
  lp_agency: "agency_lp_inquiries",
  line: "lead_line",
  threads_dm: "lead_agency",
  // ★電話とメールは手入力。仕組みで計測するものではないので常に計測済み扱い
  phone_manual: "lead_direct_inquiry",
  email: "lead_direct_inquiry",
};

export async function getSourceBreakdown(
  days = 30,
  now: Date = new Date(),
): Promise<SourceBreakdown> {
  const since = new Date(now.getTime() - days * 86400000);

  const [leads, coverages, lineFollowObserved, clickAgg] = await Promise.all([
    prisma.lead.findMany({
      select: {
        sourceType: true,
        status: true,
        closedAmount: true,
        firstResponseAt: true,
      },
    }),
    prisma.measurementCoverage.findMany({ select: { metric: true } }),
    prisma.lineFriend.count(),
    prisma.contentMetric.aggregate({
      _sum: { value: true },
      where: { metric: "threads_link_clicks_line", date: { gte: since } },
    }),
  ]);

  const covered = new Set(coverages.map((c) => c.metric));
  const acc = new Map<string, { leads: number; won: number; amount: number; unresponded: number }>();
  for (const l of leads) {
    const k = l.sourceType;
    const cur = acc.get(k) ?? { leads: 0, won: 0, amount: 0, unresponded: 0 };
    cur.leads += 1;
    if (l.status === "won") {
      cur.won += 1;
      cur.amount += l.closedAmount ? Number(l.closedAmount) : 0;
    }
    if (!l.firstResponseAt) cur.unresponded += 1;
    acc.set(k, cur);
  }

  // ★旧値 lp_form の行が残っていたら末尾に出す。黙って消すと件数が合わなくなる
  const order = acc.has("lp_form") ? [...SOURCE_ORDER, "lp_form"] : SOURCE_ORDER;
  const rows: SourceRow[] = order.map((k) => {
    const a = acc.get(k) ?? { leads: 0, won: 0, amount: 0, unresponded: 0 };
    return {
      key: k,
      label: SOURCE_LABEL[k] ?? k,
      leads: a.leads,
      won: a.won,
      wonAmount: a.amount,
      closeRate: a.leads > 0 ? a.won / a.leads : null,
      unresponded: a.unresponded,
      measured: covered.has(SOURCE_COVERAGE[k] ?? ""),
    };
  });

  const total: SourceRow = {
    key: "total",
    label: "合計",
    leads: rows.reduce((s, r) => s + r.leads, 0),
    won: rows.reduce((s, r) => s + r.won, 0),
    wonAmount: rows.reduce((s, r) => s + r.wonAmount, 0),
    closeRate: null,
    unresponded: rows.reduce((s, r) => s + r.unresponded, 0),
    measured: rows.some((r) => r.measured),
  };
  total.closeRate = total.leads > 0 ? total.won / total.leads : null;

  return {
    rows,
    total,
    // ★Webhook 設置以降しか観測していない。0 件なら「まだ観測していない」
    lineFriends: lineFollowObserved > 0 ? lineFollowObserved : null,
    threadsToLineClicks: Math.round(clickAgg._sum.value ?? 0),
    days,
  };
}
