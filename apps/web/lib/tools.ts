// 運用ツールの契約管理（2026-07-21 追加・設計書には無い）
//
// ★なぜ作ったか（実害が2件出た日に追加）
//   1) ラッコのプランを誤認し、使えない機能で作業させてしまった
//   2) DataForSEO の残高が $0.137 まで枯渇し、週次のSERP取得が止まる寸前だった
//   どちらも「今どのプランで、いくら払い、あといくら残っているか」が
//   どこにも無かったことが原因。
//
// ★効果（ROI）は自動算出しない。
//   「このツールが何円の売上を生んだか」は分解不能で、算出すれば
//   根拠のない数字が出る。導入時に purpose / expectedOutcome / decideBy を
//   書き、期日に人が判定する（Action → Intervention → Learning と同じ形）。
import { prisma } from "@mms/db";

export const TOOL_STATE_LABEL: Record<string, string> = {
  considering: "検討中",
  trial: "トライアル",
  active: "契約中",
  stopped: "停止",
};

export const BILLING_LABEL: Record<string, string> = {
  monthly: "月額",
  prepaid: "前払い/従量",
  free: "無料",
};

export type ToolRow = {
  id: string;
  name: string;
  vendor: string | null;
  plan: string | null;
  billingType: string;
  monthlyYen: number | null;
  balance: number | null;
  balanceCurrency: string | null;
  balanceCheckedAt: Date | null;
  state: string;
  purpose: string;
  expectedOutcome: string | null;
  decideBy: Date | null;
  decision: string | null;
  decidedAt: Date | null;
  note: string | null;
  /** 判定期日を過ぎているのに未判定 */
  overdue: boolean;
};

export type ToolsView = {
  rows: ToolRow[];
  /** 契約中＋トライアルの月額合計（円）。前払い/無料は含めない */
  monthlyTotalYen: number;
  /** 月額が未入力の契約中ツール数。合計が過少に見えるのを防ぐため出す */
  monthlyUnknown: number;
  overdueCount: number;
};

export async function getTools(now: Date = new Date()): Promise<ToolsView> {
  const rows = await prisma.toolSubscription.findMany({
    orderBy: [{ state: "asc" }, { name: "asc" }],
  });

  const view: ToolRow[] = rows.map((t) => ({
    id: t.id,
    name: t.name,
    vendor: t.vendor,
    plan: t.plan,
    billingType: t.billingType,
    monthlyYen: t.monthlyYen === null ? null : Number(t.monthlyYen),
    balance: t.balance === null ? null : Number(t.balance),
    balanceCurrency: t.balanceCurrency,
    balanceCheckedAt: t.balanceCheckedAt,
    state: t.state,
    purpose: t.purpose,
    expectedOutcome: t.expectedOutcome,
    decideBy: t.decideBy,
    decision: t.decision,
    decidedAt: t.decidedAt,
    note: t.note,
    overdue:
      t.decideBy !== null && t.decidedAt === null && t.decideBy.getTime() < now.getTime(),
  }));

  const paying = view.filter((t) => t.state === "active" || t.state === "trial");
  return {
    rows: view,
    monthlyTotalYen: paying.reduce((s, t) => s + (t.monthlyYen ?? 0), 0),
    // ★月額未入力を黙って0円として合計すると「安く見える」。件数を別に出す
    monthlyUnknown: paying.filter((t) => t.billingType === "monthly" && t.monthlyYen === null)
      .length,
    overdueCount: view.filter((t) => t.overdue).length,
  };
}

/** 段7に出す警告（残高不足・判定期日超過） */
export type ToolAlert = { kind: "balance" | "overdue"; message: string };

export async function getToolAlerts(now: Date = new Date()): Promise<ToolAlert[]> {
  const { rows } = await getTools(now);
  const out: ToolAlert[] = [];

  for (const t of rows) {
    if (t.overdue && t.decideBy) {
      out.push({
        kind: "overdue",
        message: `${t.name}: 判定期日（${t.decideBy.toLocaleDateString("ja-JP")}）を過ぎています`,
      });
    }
    // ★残高は「未取得」と「0」を区別する。null は警告しない（測っていないだけ）
    if (t.state !== "stopped" && t.balance !== null && t.balance <= 0.3) {
      out.push({
        kind: "balance",
        message: `${t.name}: 残高 ${t.balance}${t.balanceCurrency ?? ""} — 補充しないとジョブが止まります`,
      });
    }
  }
  return out;
}
