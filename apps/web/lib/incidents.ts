// 過去の事故と再発防止（設計書 §3.10.6 / P3.10）
//
// ★「事故を記録しないと、対策は個別ファイルの1行に埋もれて失われる」（§3.10.6）。
//   記録するだけでなく**画面に出す**。出さないと結局誰も読まない。
//
// ★見るべきは「何件あったか」ではなく「対策が入っているか」。
//   done:false が残っているものは、同じ事故がもう一度起きうるということ。
import { prisma } from "@mms/db";

export type PreventionAction = { action: string; done: boolean; ref?: string };

export type IncidentRow = {
  id: string;
  occurredAt: Date;
  severity: string;
  category: string;
  title: string;
  actions: PreventionAction[];
  /** 未実装の再発防止策の数。0 なら守られている */
  pending: number;
};

export type IncidentSummary = {
  total: number;
  /** 再発防止策がまだ入っていない事故の件数。★ここが0でないと「対策済み」とは言えない */
  withPending: number;
  pendingActions: number;
  rows: IncidentRow[];
};

const SEVERITY_LABEL: Record<string, string> = {
  critical: "重大",
  high: "大",
  medium: "中",
  low: "小",
};

const CATEGORY_LABEL: Record<string, string> = {
  performance: "速度",
  data_quality: "データの正しさ",
  availability: "停止",
  security: "セキュリティ",
  quality: "運用の質",
};

export const severityLabel = (v: string) => SEVERITY_LABEL[v] ?? v;
export const categoryLabel = (v: string) => CATEGORY_LABEL[v] ?? v;

function parseActions(v: unknown): PreventionAction[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((a) => {
    if (!a || typeof a !== "object") return [];
    const o = a as Record<string, unknown>;
    if (typeof o.action !== "string") return [];
    return [{ action: o.action, done: o.done === true, ref: typeof o.ref === "string" ? o.ref : undefined }];
  });
}

export async function getIncidents(): Promise<IncidentSummary> {
  const rows = await prisma.incident.findMany({
    orderBy: [{ severity: "asc" }, { occurredAt: "desc" }],
    select: {
      id: true,
      occurredAt: true,
      severity: true,
      category: true,
      title: true,
      preventionActions: true,
    },
  });

  const mapped: IncidentRow[] = rows.map((r) => {
    const actions = parseActions(r.preventionActions);
    return {
      id: r.id,
      occurredAt: r.occurredAt,
      severity: r.severity,
      category: r.category,
      title: r.title,
      actions,
      pending: actions.filter((a) => !a.done).length,
    };
  });

  // ★未対策のものを上に出す。件数の多さではなく「まだ危ないもの」から見る
  mapped.sort((a, b) => b.pending - a.pending || b.occurredAt.getTime() - a.occurredAt.getTime());

  return {
    total: mapped.length,
    withPending: mapped.filter((r) => r.pending > 0).length,
    pendingActions: mapped.reduce((s, r) => s + r.pending, 0),
    rows: mapped,
  };
}
