// 代理店リードの集計（設計書 §3-6・§14.4・P5.6）
//
// ★なぜ手入力なのか
//   Threads には DM を取得する API が無い（DMはInstagram側の機能）。
//   代理店募集トラック（AGC-001）は投稿だけ自動化されていて、その先の
//   DM → 自己選別 → 契約 が一切記録されていなかった。
//   自動取得できない以上、手入力の導線を用意するのが唯一の解。
//
// ★これが無いと何が壊れるか
//   代理店投稿を views で評価してしまう。代理店募集は対象が狭くviewsは
//   伸びないのが当然で、実際 threads_format_shift が「A12を減らせ」という
//   有害な提案を出した。正しい評価軸は angle 別の DM 獲得数。
import { prisma } from "@mms/db";

/** §3 AgencyLeadStage の並び順（歩留まりを出すため順序が要る） */
export const STAGE_ORDER = [
  "received",
  "screening_sent",
  "answered",
  "qualified",
  "forwarded",
  "contracted",
] as const;

export type Stage = (typeof STAGE_ORDER)[number] | "rejected";

export const STAGE_LABEL: Record<string, string> = {
  received: "DM受信",
  screening_sent: "選別質問を送付",
  answered: "回答あり",
  qualified: "有効",
  forwarded: "取次済",
  contracted: "契約",
  rejected: "見送り",
};

export type AgencyLeadRow = {
  id: string;
  threadsUserId: string;
  receivedAt: Date;
  sourcePostId: string | null;
  /** sourcePostId から引いた angle（A01 等）。紐付かなければ null */
  sourceAngle: string | null;
  stage: string;
};

export type StageCount = { stage: string; label: string; count: number };

/** angle別のDM獲得。★代理店投稿の評価軸はこれであって views ではない */
export type AngleStat = {
  angle: string;
  posts: number;
  leads: number;
  qualified: number;
  contracted: number;
  /** 1投稿あたりのDM数。投稿数が違う angle を並べて比較するために要る */
  leadsPerPost: number | null;
};

export type AgencyData = {
  total: number;
  stages: StageCount[];
  byAngle: AngleStat[];
  recent: AgencyLeadRow[];
  /** 代理店投稿はあるがDM記録が1件も無い状態か（＝未計測） */
  unmeasured: boolean;
};

export async function getAgencyData(): Promise<AgencyData> {
  const [leads, agencyPosts] = await Promise.all([
    prisma.agencyLead.findMany({
      orderBy: { receivedAt: "desc" },
      select: {
        id: true,
        threadsUserId: true,
        receivedAt: true,
        sourcePostId: true,
        stage: true,
      },
    }),
    prisma.contentItem.findMany({
      where: { type: "post", channel: { type: "threads" }, targetLabel: "代理店候補" },
      select: { externalId: true, note: true },
    }),
  ]);

  // THR-xxx → angle（note に angle が入っている）
  const angleByPost = new Map(agencyPosts.map((p) => [p.externalId, p.note?.trim() || "unknown"]));
  const postsPerAngle = new Map<string, number>();
  for (const p of agencyPosts) {
    const a = p.note?.trim() || "unknown";
    postsPerAngle.set(a, (postsPerAngle.get(a) ?? 0) + 1);
  }

  const rows: AgencyLeadRow[] = leads.map((l) => ({
    ...l,
    sourceAngle: l.sourcePostId ? (angleByPost.get(l.sourcePostId) ?? null) : null,
  }));

  const stageCount = new Map<string, number>();
  for (const l of leads) stageCount.set(l.stage, (stageCount.get(l.stage) ?? 0) + 1);
  const stages: StageCount[] = [...STAGE_ORDER, "rejected"].map((s) => ({
    stage: s,
    label: STAGE_LABEL[s] ?? s,
    count: stageCount.get(s) ?? 0,
  }));

  // angle別。★投稿はあるがDMが0件の angle も出す（0件であることが情報）
  const byAngle: AngleStat[] = [...postsPerAngle.entries()]
    .map(([angle, posts]) => {
      const mine = rows.filter((r) => r.sourceAngle === angle);
      return {
        angle,
        posts,
        leads: mine.length,
        qualified: mine.filter((r) =>
          ["qualified", "forwarded", "contracted"].includes(r.stage),
        ).length,
        contracted: mine.filter((r) => r.stage === "contracted").length,
        leadsPerPost: posts > 0 ? Math.round((mine.length / posts) * 100) / 100 : null,
      };
    })
    .sort((a, b) => (b.leadsPerPost ?? 0) - (a.leadsPerPost ?? 0));

  return {
    total: leads.length,
    stages,
    byAngle,
    recent: rows.slice(0, 30),
    // ★投稿はしているのにDM記録が0件＝「DMが来ていない」ではなく「記録していない」。
    //   §3 の規約どおり、0件と未計測を混同させない
    unmeasured: leads.length === 0 && agencyPosts.length > 0,
  };
}
