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

/**
 * 入口（どこから公式LINEへ送っているか）。2026-07-23 石井さん。
 *
 * ★段①を「Threadsからのクリック」だけで作っていたため、
 *   「① 送客 —(未計測)（まだ1件もクリックされていない）」と出て、
 *   **LINEへ誰も送っていない**ように読めていた。実際は HP・記事の lin.ee が
 *   生リンクで、送ってはいるが測っていない。意味がまるで違う。
 *
 * ★「不明」は登録のうち経路が分からないもの。LINE の follow イベントには
 *   経路情報が入らない（LINE の仕様）ので、原理的にここは残る。
 */
export type Entrance = {
  key: "hp" | "media" | "threads" | "unknown";
  label: string;
  /** クリック数。null = 未計装（0 とは別） */
  clicks: number | null;
  /** その入口の状態と、測れるようにする手 */
  note: string;
};

export type LineChannel = {
  days: number;
  entrances: Entrance[];
  /**
   * 友だちの状況。
   * ★総数は webhook では取れない。設置前の友だちには event が起きないため。
   *   出せるのは「設置以降の追加・ブロック」だけ。総数は別で持つ必要がある。
   */
  friends: {
    /** 総数。null = 未取得（基準値も API 接続も無い） */
    total: number | null;
    /** 設置以降に観測した追加（期間内） */
    added: number;
    /**
     * ブロック数。★画面には出さない（2026-07-23 石井さん）。
     *   総数（API）が friends.total で取れるので、画面で見る値ではない。
     *   ただし総数の算出（追加延べ − ブロック）には要るので保持する。
     */
    blocked: number;
    note: string;
  };
  /** ②③の計測開始日。期間の途中から測り始めた場合に画面へ出す */
  webhookStartedAt: Date | null;
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

  const [clickRows, friends, inbounds, leads, coverages, lineHealth, blockedCount] =
    await Promise.all([
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
    // ★友だち総数は SnsAccountHealth（channel=line）に入れる。
    //   webhook では取れないので、API 接続か基準値の手入力で埋める
    prisma.snsAccountHealth.findFirst({
      where: { channel: { type: "line" } },
      orderBy: { date: "desc" },
      select: { followers: true, date: true },
    }),
    prisma.lineFriend.count({ where: { status: "blocked" } }),
  ]);

  const startedOf = new Map(coverages.map((c) => [c.metric, c.startedAt]));
  const sentStart = startedOf.get("threads_link_clicks_line") ?? null;
  const siteStart = startedOf.get("site_link_clicks_line") ?? null;
  // ★登録・反応は Webhook が入って初めて測れる。lead_line がその印
  const lineStart = startedOf.get("lead_line") ?? null;
  const sentMeasured = sentStart !== null;
  const lineMeasured = lineStart !== null;

  // ── 入口別の送客（HP / メディア / Threads / 不明）──
  const threadsClicks = clickRows.reduce((s, r) => s + r.value, 0);
  const siteRows = await prisma.metricSnapshot.findMany({
    where: { metric: { startsWith: "site_link_clicks_line__" }, date: win },
    select: { metric: true, value: true },
  });
  const siteBy = { hp: 0, media: 0, other: 0 };
  for (const r of siteRows) {
    const src = r.metric.split("__")[1] ?? "";
    if (src.startsWith("hp")) siteBy.hp += r.value;
    else if (src.startsWith("media") || src.startsWith("article")) siteBy.media += r.value;
    else siteBy.other += r.value;
  }

  const entrances: Entrance[] = [
    {
      key: "hp",
      label: "HP",
      // ★1度も計測が始まっていないなら 0 ではなく未計装（§3）
      clicks: siteStart ? Math.round(siteBy.hp) : null,
      note: siteStart
        ? "/r/line/hp-… のクリック"
        : "テーマの lin.ee が生リンク（/contact/ 7箇所）。/r/line/hp-… に変えれば測れる",
    },
    {
      key: "media",
      label: "メディア（記事）",
      clicks: siteStart ? Math.round(siteBy.media) : null,
      note: siteStart
        ? "/r/line/media-… のクリック"
        : "記事内の lin.ee が生リンク（/media/ 9箇所）。/r/line/media-… に変えれば測れる",
    },
    {
      key: "threads",
      label: "Threads",
      clicks: sentStart ? Math.round(threadsClicks) : null,
      note: sentStart
        ? "/r/line/<投稿ID> のクリック"
        : "投稿にLINEへのリンクが1本も無い（cowork が22本を投入済み・投稿待ち）",
    },
    {
      key: "unknown",
      label: "不明",
      // ★登録から、経路が分かっているクリックを引いた残り…は出せない。
      //   クリックと登録は別人の可能性があり、引き算すると嘘になる
      clicks: null,
      note: "LINE の follow イベントに経路情報が入らない（LINE 仕様）。原理的に測れない",
    },
  ];
  const measuredEntrances = entrances.filter((e) => e.clicks !== null);

  // ── 段の値 ──
  // ★段①は入口の合計。測れている入口が1つも無ければ未計測（0 ではない）
  const sent = measuredEntrances.reduce((s, e) => s + (e.clicks ?? 0), 0);
  const sentMeasuredAny = measuredEntrances.length > 0;
  const followed = friends.length;
  const replied = inbounds.length;
  const inquired = leads.length;
  // ★計測開始より前に起票した件数。②登録0なのに④問い合わせ2、という
  //   ファネルとして成立しない並びは、これが原因（Webhook設置前の遡及入力）。
  //   黙って並べると「登録0から問い合わせが2件生まれた」と読めてしまう
  const retroactive = lineStart
    ? leads.filter((l) => l.occurredAt < lineStart).length
    : leads.length;
  const won = leads.filter((l) => l.status === "won").length;
  const wonAmount = leads.reduce(
    (s, l) => s + (l.status === "won" && l.closedAmount ? Number(l.closedAmount) : 0),
    0,
  );

  const stages: Stage[] = [
    {
      key: "sent",
      label: "① 送客",
      value: sentMeasuredAny ? sent : null,
      pendingLabel: "—(未計装)",
      hint: `入口 ${measuredEntrances.length}/3 を計測中`,
      action: "生リンクを /r/line/… に変える（HP・記事）",
    },
    {
      // ★計測開始より前は「0件」ではなく測っていない期間。
      //   90日窓のうち Webhook 後だけが実測なのに 0 と出していた
      key: "followed",
      label: "② 登録",
      value: lineMeasured ? followed : null,
      hint: lineStart
        ? `友だち追加（${ymd(lineStart)}〜の実測）`
        : "友だち追加（Webhook 未設置）",
      action: "登録画面と登録の動機（軽オファー）を作る",
    },
    {
      key: "replied",
      label: "③ 反応",
      value: lineMeasured ? replied : null,
      hint: lineStart
        ? `受信したメッセージ（${ymd(lineStart)}〜の実測）`
        : "受信したメッセージ（Webhook 未設置）",
      action: "あいさつメッセージと初回の導線を作り直す",
    },
    {
      key: "inquired",
      label: "④ 問い合わせ",
      value: inquired,
      hint:
        retroactive > 0
          ? `起票した数（うち${retroactive}件は計測開始前の遡及入力）`
          : "商談になりうるものとして起票した数",
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
  const unmeasuredEntrances = entrances.filter((e) => e.clicks === null && e.key !== "unknown");
  if (unmeasuredEntrances.length > 0) {
    notMeasured.push(
      `① 送客のうち ${unmeasuredEntrances.map((e) => e.label).join("・")} が未計装（送っていないのではなく測っていない）`,
    );
  }
  if (!lineMeasured) notMeasured.push("② 登録・③ 反応（LINE Webhook が未設置）");
  if (retroactive > 0 && lineStart) {
    notMeasured.push(
      `④ 問い合わせ ${inquired}件のうち ${retroactive}件は ${ymd(lineStart)} の計測開始より前の遡及入力（②③の実測期間に含まれない。段の上下は比較できない）`,
    );
  }

  return {
    days: range.days,
    entrances,
    friends: {
      total: lineHealth?.followers ?? null,
      added: friends.length,
      blocked: blockedCount,
      note: lineHealth
        ? `総数は ${ymd(lineHealth.date)} 時点の記録`
        : "★友だち総数は webhook では取れません（設置前の友だちには event が起きないため）。埋める方法は2つ: ①Messaging API のチャネルアクセストークンを設定して日次取得する ②LINE公式アカウント管理画面の友だち数を基準値として記録する。追加・ブロックは設置（2026-07-22）以降のみ観測しています。",
    },
    webhookStartedAt: lineStart,
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
