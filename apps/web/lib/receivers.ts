// 受け皿ごとの実績（HPの問い合わせ／電話）
//
// ★なぜ受け皿ごとに画面が要るか（2026-07-23 石井さん）
//   1. 代理店見込みと見込み客のどちらが多いかを受け皿ごとに判断する
//   2. その受け皿で受けた問い合わせを、その場で追加登録する
//   3. 期間を切って統計を見る
//   リード統計の1行として合計だけ見えていても、この3つはできない。
//
// ★HPの問い合わせフォームと info メールは同一（2026-07-23 訂正）。
//   フォーム送信が info@ に届くだけで、別経路ではない。受け皿は1つ。
import { prisma } from "@mms/db";
import { dayKeys, jstDayKey, type Range } from "./period";
import { ORIGIN_LABEL, ORIGIN_ORDER } from "./leads";

export type ReceiverKindRow = {
  key: string;
  label: string;
  leads: number;
  prevLeads: number;
  won: number;
  wonAmount: number;
};

export type ReceiverLead = {
  id: string;
  occurredAt: Date;
  type: string;
  status: string;
  origin: string;
  originLabel: string;
  companyMasked: string;
  contactMasked: string;
  closedAmount: string | null;
  note: string | null;
};

export type ReceiverStats = {
  total: number;
  prevTotal: number;
  won: number;
  wonAmount: number;
  /** 見込み客 / 代理店見込み の内訳。★どちらが多いかがこの画面の主目的 */
  byKind: ReceiverKindRow[];
  /** きっかけ（施策）別。電話でも聞けば埋まる */
  byOrigin: { key: string; label: string; leads: number }[];
  /** 「不明」の割合＝ヒアリングの実行率。null は母数0 */
  unknownRate: number | null;
  trend: { date: string; value: number | null }[];
  leads: ReceiverLead[];
  measured: boolean;
  days: number;
};

const KINDS = [
  { key: "direct_inquiry", label: "見込み客" },
  { key: "agency", label: "代理店見込み" },
  { key: "line_friend", label: "LINE登録" },
] as const;

/**
 * @param sourceTypes この受け皿に含める Lead.sourceType（複数可）
 * @param coverageMetric 計測開始の記録（§3）。無ければ「未計測」
 */
export async function getReceiverStats(
  sourceTypes: string[],
  coverageMetric: string,
  range: Range,
): Promise<ReceiverStats> {
  const where = { sourceType: { in: sourceTypes as never[] } };
  const [cur, prev, coverage] = await Promise.all([
    prisma.lead.findMany({
      where: { ...where, occurredAt: { gte: range.since, lt: range.until } },
      orderBy: { occurredAt: "desc" },
      select: {
        id: true,
        occurredAt: true,
        type: true,
        status: true,
        origin: true,
        closedAmount: true,
        companyName: true,
        contactEmail: true,
        contactPhone: true,
        note: true,
      },
    }),
    prisma.lead.findMany({
      where: { ...where, occurredAt: { gte: range.prev.since, lt: range.prev.until } },
      select: { type: true },
    }),
    prisma.measurementCoverage.findFirst({ where: { metric: coverageMetric }, select: { id: true } }),
  ]);

  const { decryptIfEncrypted, maskContact } = await import("./crypto");

  const byKind: ReceiverKindRow[] = KINDS.filter(
    (k) => k.key !== "line_friend" || cur.some((l) => l.type === "line_friend"),
  ).map((k) => {
    const mine = cur.filter((l) => l.type === k.key);
    return {
      key: k.key,
      label: k.label,
      leads: mine.length,
      prevLeads: prev.filter((l) => l.type === k.key).length,
      won: mine.filter((l) => l.status === "won").length,
      wonAmount: mine
        .filter((l) => l.status === "won")
        .reduce((s, l) => s + (l.closedAmount ? Number(l.closedAmount) : 0), 0),
    };
  });

  const originCount = new Map<string, number>();
  for (const l of cur) originCount.set(l.origin, (originCount.get(l.origin) ?? 0) + 1);

  const keys = dayKeys(range.since, range.until);
  const byDay = new Map<string, number>();
  for (const l of cur) {
    const k = jstDayKey(l.occurredAt);
    byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }

  return {
    total: cur.length,
    prevTotal: prev.length,
    won: cur.filter((l) => l.status === "won").length,
    wonAmount: cur
      .filter((l) => l.status === "won")
      .reduce((s, l) => s + (l.closedAmount ? Number(l.closedAmount) : 0), 0),
    byKind,
    byOrigin: ORIGIN_ORDER.map((k) => ({
      key: k,
      label: ORIGIN_LABEL[k] ?? k,
      leads: originCount.get(k) ?? 0,
    })),
    unknownRate: cur.length ? (originCount.get("unknown") ?? 0) / cur.length : null,
    // ★問い合わせは「その日0件」が事実として意味を持つ（計測は動いている）。
    //   未計測の受け皿だけ線を引かない（§3）
    trend: keys.map((k) => ({
      date: k,
      value: coverage ? (byDay.get(k) ?? 0) : null,
    })),
    leads: cur.map((l) => ({
      id: l.id,
      occurredAt: l.occurredAt,
      type: l.type,
      status: l.status,
      origin: l.origin,
      originLabel: ORIGIN_LABEL[l.origin] ?? l.origin,
      // ★個人情報は復号 → マスキング（§16.2）
      companyMasked: maskContact(decryptIfEncrypted(l.companyName)),
      contactMasked: maskContact(
        decryptIfEncrypted(l.contactEmail) ?? decryptIfEncrypted(l.contactPhone),
      ),
      closedAmount: l.closedAmount ? l.closedAmount.toString() : null,
      note: l.note ? decryptIfEncrypted(l.note) : null,
    })),
    measured: Boolean(coverage),
    days: range.days,
  };
}
