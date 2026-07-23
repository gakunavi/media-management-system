// 公式LINE の階段（設計書 §4.2・§5.3）。受け皿の1つで、ゴールは問い合わせ
//
// ★なぜ経路ごとに画面を分けるか
//   /leads は「どの経路が何件取れたか」の総合。そこだけ見ても、
//   落ちている段が分からないので打ち手が決まらない。
//   経路ごとに階段を出し、**どの段で落ちているか**を明示する。
//
// ★このシステムのゴールは問い合わせ数を増やすこと。
//   PV・クリック・登録はそのための手前の数字で、どこで落ちているかを見る。
//
// ★階段は3段（2026-07-23 石井さんの指摘で作り直した）:
//     ① 登録   … 登録画面・登録の動機（軽オファー）
//     ② 問い合わせ … あいさつ・会話の質・返信テンプレ
//     ③ 成約   … オファー・価格
//
//   旧実装は「送客 → 登録 → 反応 → 問い合わせ → 成約」の5段だったが、
//   2つ誤りがあった:
//
//   1. 送客（クリック）を階段の1段目に置いていた。クリックと登録は
//      **別の計測系で、同じ人だと確認する手段が無い**（LINE の follow に
//      経路情報が入らない）。率を出しても意味が無く、
//      「送ったのに登録されていない」という読み方は成立しない。
//      送客は「入口」として別枠に出す（entrances）。
//   2. 「反応」（受信メッセージ・スタンプを含む）を段にしていた。
//      問い合わせと何が違うのかが運用上あいまいで、打ち手も同じ。
//      見るのは問い合わせだけでよい。
//
// ★階段は種別（見込み客／代理店見込み）で割らない。
//   登録の時点では相手がどちらか分からず、分母が割れないため。
//   割れるのは問い合わせ以降だけなので、内訳は種別パネルで見る。
//
// ★段ごとに「未計測」を持つ。0 と混ぜると、壊れている計測が
//   「成果ゼロ」に化ける（診断LPの lp_form_submit で実際に起きた）。
import { prisma } from "@mms/db";
import { buildFlow, type Stage as SharedStage } from "./stages";
import { dayKeys, jstDayKey, type Range } from "./period";

export type StageKey = "followed" | "inquired" | "won";

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
    /**
     * 期末時点の総数。null = その時点のスナップショットが無い（未計測）。
     * ★「常に最新」を出してはいけない。先月を見ているのに今日の値が出ると、
     *   期間を変えても数字が動かず「ベタ書き」と区別がつかない（実際そうなっていた）。
     */
    total: number | null;
    /** 期末時点のスナップショットの日付 */
    totalAsOf: Date | null;
    /**
     * 期間内の増減（期末 − 期首）。null = 期首か期末のスナップショットが無い。
     * ★webhook の follow 件数ではなくスナップショットの差分で出す。
     *   webhook は設置（7/22）以降しか観測できず、それ以前の増減が0に見える。
     */
    change: number | null;
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
  // ★日付列（@db.Date）とタイムスタンプ列で境界が違う（lib/period.ts）
  const win = range.dateWindow;
  const tsWin = { gte: range.since, lt: range.until };
  const keys = dayKeys(range.since, range.until);

  const [clickRows, friends, leads, coverages, healthEnd, healthStart, healthDaily] =
    await Promise.all([
    prisma.contentMetric.findMany({
      where: { metric: "threads_link_clicks_line", date: win },
      select: { value: true, date: true, contentItem: { select: { note: true, id: true } } },
    }),
    prisma.lineFriend.findMany({
      where: { addedAt: tsWin },
      select: { addedAt: true },
    }),
    prisma.lead.findMany({
      where: { sourceType: "line", occurredAt: tsWin },
      select: { occurredAt: true, status: true, closedAmount: true },
    }),
    prisma.measurementCoverage.findMany({ select: { metric: true, startedAt: true } }),
    // ★友だち数は SnsAccountHealth（channel=line）に日次で入っている
    //   （builtin/line_followers.py が Messaging API から取得）。
    //   期末時点の値を出すため、期間の終わり以前で最新の1行を引く
    prisma.snsAccountHealth.findFirst({
      where: { channel: { type: "line" }, date: { lt: range.dateWindow.lt } },
      orderBy: { date: "desc" },
      select: { followers: true, date: true },
    }),
    // 期首（期間開始の前日以前で最新）。増減はこの差分で出す
    prisma.snsAccountHealth.findFirst({
      where: { channel: { type: "line" }, date: { lt: range.dateWindow.gte } },
      orderBy: { date: "desc" },
      select: { followers: true, date: true },
    }),
    // 推移用（期間内の日次スナップショット）
    prisma.snsAccountHealth.findMany({
      where: { channel: { type: "line" }, date: win },
      orderBy: { date: "asc" },
      select: { followers: true, date: true },
    }),
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
        // ★2026-07-23 に張り替え済み（v175）。踏まれれば実数になる。
        //   HP面のLINE導線は4本しかない（contact・トップ2・判定ツール）。
        //   header/footer はメディア面専用テンプレなのでHPには出ない
        : "計装済み（4本: contact・トップ2・判定ツール）。まだ踏まれていない",
    },
    {
      key: "media",
      label: "メディア（記事）",
      clicks: siteStart ? Math.round(siteBy.media) : null,
      note: siteStart
        ? "/r/line/media-… のクリック"
        : "計装済み（記事末2本・ヘッダ/フッタ6本・一覧5本）。まだ踏まれていない",
    },
    {
      key: "threads",
      label: "Threads",
      clicks: sentStart ? Math.round(threadsClicks) : null,
      note: sentStart
        ? "/r/line/<投稿ID> のクリック"
        : "投稿キューに22本を投入済み（投稿待ち）",
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

  // ── 友だち数（期末時点と期間内の増減）──
  // ★階段の1段目はここ。登録が最初に数えられる単位で、
  //   送客（クリック）とは計測系が違うので同じ階段に載せない
  const friendsChange =
    healthEnd && healthStart ? healthEnd.followers - healthStart.followers : null;

  // ── 段の値 ──
  // ★段①は入口の合計。測れている入口が1つも無ければ未計測（0 ではない）
  const sent = measuredEntrances.reduce((s, e) => s + (e.clicks ?? 0), 0);
  const sentMeasuredAny = measuredEntrances.length > 0;
  const followed = friends.length;
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
      key: "followed",
      label: "① 登録",
      // ★期間内の増減（期末 − 期首）。webhook の follow 件数は設置以降しか
      //   観測できないので使わない
      value: friendsChange,
      hint:
        friendsChange === null
          ? "期首の記録が無い期間（取り込み途中）"
          : "友だち数の増減（Messaging API）",
      action: "登録画面と登録の動機（軽オファー）を作る",
    },
    {
      key: "inquired",
      label: "② 問い合わせ",
      value: inquired,
      hint:
        retroactive > 0
          ? `起票した数（うち${retroactive}件は計測開始前の遡及入力）`
          : "商談になりうるものとして起票した数",
      action: "あいさつメッセージ・会話の質・返信テンプレを見直す",
    },
    {
      key: "won",
      label: "③ 成約",
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
  if (friendsChange === null) {
    notMeasured.push("① 登録（この期間の期首に友だち数の記録が無い。履歴の取り込みは日次で進む）");
  }
  if (retroactive > 0 && lineStart) {
    notMeasured.push(
      `② 問い合わせ ${inquired}件のうち ${retroactive}件は ${ymd(lineStart)} の計測開始より前の遡及入力`,
    );
  }

  return {
    days: range.days,
    entrances,
    friends: {
      total: healthEnd?.followers ?? null,
      totalAsOf: healthEnd?.date ?? null,
      // ★期首が無い期間（取得開始前を含む期間）では増減を出さない。
      //   0 と書くと「増えていない」に見えるが、実際は比べる基準が無い（§3）
      change: friendsChange,
      note: healthEnd
        ? `Messaging API から日次取得（友だち数＝追加延べ − ブロック）。総数は ${ymd(healthEnd.date)} 時点。★どの入口から登録したかは LINE 仕様で取れない`
        : "★この期間の友だち数の記録がありません（取得開始は 2026-07-16）。webhook では総数が取れないため、Messaging API から日次で取り込んでいます。",
    },
    webhookStartedAt: lineStart,
    stages,
    transitions,
    biggestDropIndex,
    comparableSegments,
    trends: {
      sent: series(sentByDay, keys, sentStart),
      // ★webhook の follow 件数ではなく、API の日次スナップショットを描く。
      //   webhook は設置以降しか観測できず、それ以前が「0」に見える
      followed: keys.map((k) => {
        const row = healthDaily.find((h) => ymd(h.date) === k);
        return { date: k, value: row ? row.followers : null };
      }),
      // 問い合わせは手入力でも入るので、期間全体を計測済みとして扱う
      inquired: series(inquiredByDay, keys, range.since),
    },
    byFormat,
    wonAmount,
    notMeasured,
  };
}
