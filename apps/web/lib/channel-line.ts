// 公式LINE の階段（設計書 §4.1 段1③・§5.3）
//
// ★なぜ経路ごとに画面を分けるか
//   /leads は「どの経路が何件取れたか」の総合。そこだけ見ても、
//   落ちている段が分からないので打ち手が決まらない。
//   経路ごとに階段を出し、**どの段で落ちているか**を明示する。
//
// ★このシステムのゴールは問い合わせ数を増やすこと。
//   PV・クリック・登録はそのための手前の数字で、どこで落ちているかを見る。
//
// ★公式LINEの階段は5段。段ごとに打つ手が違う:
//     ① 送客   … 投稿の型・CTA文言       （/threads の →LINE 列と同じ数字）
//     ② 登録   … LINE登録画面・登録の動機（軽オファー）
//     ③ 反応   … あいさつメッセージ・初回の作り
//     ④ 問い合わせ … 会話の質・返信テンプレ
//     ⑤ 成約   … オファー・価格
//
// ★段ごとに「未計測」を持つ。0 と混ぜると、壊れている計測が
//   「成果ゼロ」に化ける（診断LPの lp_form_submit で実際に起きた）。
import { prisma } from "@mms/db";
import { buildFlow, type Stage as SharedStage } from "./stages";
import { dayKeys, jstDayKey, type Range } from "./period";

export type StageKey = "sent" | "followed" | "replied" | "inquired" | "won";

/** 階段の1段。定義は lib/stages.ts（全画面で同じ形にそろえる） */
export type Stage = SharedStage;

export type TrendPoint = { date: string; value: number | null };

export type FormatShare = {
  format: string;
  clicks: number;
  posts: number;
};

export type LineChannel = {
  days: number;
  stages: Stage[];
  /** 段間の転換率。stages[i-1] → stages[i]。null は算出不能 */
  transitions: (number | null)[];
  /** 最大ドロップの段 index（transitions 内）。null は判定不可 */
  biggestDropIndex: number | null;
  /** 転換率を出せた区間の数。1以下なら落ち込みは比較できない */
  comparableSegments: number;
  trends: {
    sent: TrendPoint[];
    followed: TrendPoint[];
    inquired: TrendPoint[];
  };
  /** 送客元の型別内訳（どの型がLINEに送ったか） */
  byFormat: FormatShare[];
  wonAmount: number;
  /** 計測開始が記録されていない段の説明。空なら全段計測中 */
  notMeasured: string[];
};

const ymd = jstDayKey;

/**
 * 日次の系列。
 * ★計測開始より前の日は 0 ではなく null にする。
 *   計測を始めた日が期間の途中だと、それ以前が 0 として描かれ
 *   「あったのに落ちた」ように見える（§3）。
 */
function series(
  map: Map<string, number>,
  keys: string[],
  startedAt: Date | null,
): TrendPoint[] {
  return keys.map((k) => {
    const measured = startedAt !== null && ymd(startedAt) <= k;
    return { date: k, value: measured ? (map.get(k) ?? 0) : null };
  });
}

export async function getLineChannel(range: Range): Promise<LineChannel> {
  // ★期間は画面（resolveRange）が決める。lib が勝手に「直近30日」を決めない
  const win = { gte: range.since, lt: range.until };
  const keys = dayKeys(range.since, range.until);

  const [clickRows, friends, inbounds, leads, coverages] = await Promise.all([
    prisma.contentMetric.findMany({
      where: { metric: "threads_link_clicks_line", date: win },
      select: { value: true, date: true, contentItem: { select: { note: true, id: true } } },
    }),
    prisma.lineFriend.findMany({
      where: { addedAt: win },
      select: { addedAt: true },
    }),
    prisma.lineInbound.findMany({
      where: { receivedAt: win },
      select: { receivedAt: true },
    }),
    prisma.lead.findMany({
      where: { sourceType: "line", occurredAt: win },
      select: { occurredAt: true, status: true, closedAmount: true },
    }),
    prisma.measurementCoverage.findMany({ select: { metric: true, startedAt: true } }),
  ]);

  const startedOf = new Map(coverages.map((c) => [c.metric, c.startedAt]));
  const sentStart = startedOf.get("threads_link_clicks_line") ?? null;
  // ★登録・反応は Webhook が入って初めて測れる。lead_line がその印
  const lineStart = startedOf.get("lead_line") ?? null;
  const sentMeasured = sentStart !== null;
  const lineMeasured = lineStart !== null;

  // ── 段の値 ──
  const sent = clickRows.reduce((s, r) => s + r.value, 0);
  const followed = friends.length;
  const replied = inbounds.length;
  const inquired = leads.length;
  const won = leads.filter((l) => l.status === "won").length;
  const wonAmount = leads.reduce(
    (s, l) => s + (l.status === "won" && l.closedAmount ? Number(l.closedAmount) : 0),
    0,
  );

  const stages: Stage[] = [
    {
      key: "sent",
      label: "① 送客",
      value: sentMeasured ? Math.round(sent) : null,
      hint: "Threads から公式LINEへのクリック",
      action: "投稿の型・CTA文言を見直す（/threads の →LINE 列）",
    },
    {
      key: "followed",
      label: "② 登録",
      value: lineMeasured ? followed : null,
      hint: "友だち追加（Webhook 観測分）",
      action: "登録画面と登録の動機（軽オファー）を作る",
    },
    {
      key: "replied",
      label: "③ 反応",
      value: lineMeasured ? replied : null,
      hint: "受信したメッセージ（スタンプ等を含む）",
      action: "あいさつメッセージと初回の導線を作り直す",
    },
    {
      key: "inquired",
      label: "④ 問い合わせ",
      value: inquired,
      hint: "商談になりうるものとして起票した数",
      action: "会話の質・返信テンプレを見直す",
    },
    {
      key: "won",
      label: "⑤ 成約",
      value: won,
      hint: "status=won",
      action: "オファー・価格を見直す",
    },
  ];

  // ── 段間の転換率と最大ドロップ（判定は lib/stages.ts に集約）──
  const { transitions, biggestDropIndex, comparableSegments } = buildFlow(stages);

  // ── 推移 ──
  const sentByDay = new Map<string, number>();
  for (const r of clickRows) sentByDay.set(ymd(r.date), (sentByDay.get(ymd(r.date)) ?? 0) + r.value);
  const followedByDay = new Map<string, number>();
  for (const f of friends) {
    const k = ymd(f.addedAt);
    followedByDay.set(k, (followedByDay.get(k) ?? 0) + 1);
  }
  const inquiredByDay = new Map<string, number>();
  for (const l of leads) {
    const k = ymd(l.occurredAt);
    inquiredByDay.set(k, (inquiredByDay.get(k) ?? 0) + 1);
  }

  // ── 送客元の型別 ──
  const fmt = new Map<string, { clicks: number; posts: Set<string> }>();
  for (const r of clickRows) {
    const name = r.contentItem?.note?.trim() || "unknown";
    const cur = fmt.get(name) ?? { clicks: 0, posts: new Set<string>() };
    cur.clicks += r.value;
    if (r.contentItem?.id) cur.posts.add(r.contentItem.id);
    fmt.set(name, cur);
  }
  const byFormat: FormatShare[] = [...fmt.entries()]
    .map(([format, v]) => ({ format, clicks: Math.round(v.clicks), posts: v.posts.size }))
    .sort((a, b) => b.clicks - a.clicks);

  const notMeasured: string[] = [];
  if (!sentMeasured) notMeasured.push("① 送客（まだ1件もクリックされていない）");
  if (!lineMeasured) notMeasured.push("② 登録・③ 反応（LINE Webhook が未設置）");

  return {
    days: range.days,
    stages,
    transitions,
    biggestDropIndex,
    comparableSegments,
    trends: {
      sent: series(sentByDay, keys, sentStart),
      followed: series(followedByDay, keys, lineStart),
      // 問い合わせは手入力でも入るので、期間全体を計測済みとして扱う
      inquired: series(inquiredByDay, keys, range.since),
    },
    byFormat,
    wonAmount,
    notMeasured,
  };
}
