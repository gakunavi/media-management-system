// Threads のゴール（2026-07-23 石井さん確定）
//
// ★Threads のゴールは**並列に2つ**ある。1本の階段ではない。
//     ① メディア送客 … 記事へ送る。問い合わせは記事側で取る
//     ② DM          … Threads内で直接問い合わせをもらう
//   これを縦に積むと、DM狙いの投稿が「送客していない」と評価され、
//   送客狙いの投稿が「DMが取れていない」と評価される。どちらも誤り。
//   狙いが違う投稿を同じ物差しで測ると、効いている型を落とすことになる。
//
// ★公式LINEへの送客は3つ目だが、扱いが違う。
//   クリックまでは /r/line/ で実測できるが、**登録の投稿別帰属は原理的に不可能**
//   （LINE の follow イベントに経路情報が載らない）。
//   だから「送客クリックは実測・その先は測定不能」として別枠に置く。
//   測定不能と未計測を混ぜない（未計測は直せるが、測定不能は直せない）。
//
// ★投稿の狙いは**貼ったリンク**で判定する（lib/threads.ts goalOfLink）。
//   自己申告の列を作ると、実際に貼ったものとズレたときに嘘が残る。
import { prisma } from "@mms/db";
import { buildFlow, type Stage, type StageFlow } from "./stages";
import { dayKeys, jstDayKey, type Range } from "./period";
import { GOAL_LABEL, type PostGoal } from "./threads";

export type GoalKey = "media" | "dm";

export type GoalCard = {
  key: GoalKey;
  label: string;
  /** そのゴールを狙った投稿数（リンク判定） */
  posts: number;
  /** その投稿群の views。成果率の分母 */
  views: number;
  /** 成果。null = 未計測（§3）。0 とは意味が違う */
  value: number | null;
  unit: string;
  /** 前期間の同じ値。増減用 */
  prev: number | null;
  /**
   * 成果率（成果 ÷ views・％）。
   * ★母数が0、または成果が未計測なら null。0% と書かない（§16.5）
   */
  rate: number | null;
  /** 1投稿あたりの成果。投稿数の違う期間・ゴールを比べるために要る */
  perPost: number | null;
  /**
   * 内訳（DMのみ）。代理店希望 / 見込み客。
   * ★同じ「Threads DM」でも打ち手が違う。代理店希望は選別と取次、
   *   見込み客は商談。混ぜると「DMが増えた」だけで中身が読めない。
   */
  breakdown?: { label: string; value: number; href: string }[];
  /** その成果の次（記事側／選別の先）への案内 */
  note: string;
  detailHref: string;
};

export type ThreadsGoals = {
  days: number;
  goals: GoalCard[];
  /** DM の階段（受信 → 選別 → 有効 → 契約） */
  dmFlow: StageFlow;
  /** メディア送客の階段（投稿 → 表示 → クリック） */
  mediaFlow: StageFlow;
  /** 狙い（リンク）が設定されていない投稿数。これが多いほど成果に繋がらない */
  unsetPosts: number;
  postsByGoal: { goal: PostGoal; label: string; posts: number }[];
  trends: {
    dms: { date: string; value: number | null }[];
    mediaClicks: { date: string; value: number | null }[];
  };
  notes: string[];
};

/** 送客クリックの指標名 */
const CLICK_METRIC: Record<string, string> = {
  media: "threads_link_clicks_soken",
  lp: "threads_link_clicks_lp",
  line: "threads_link_clicks_line",
};

export async function getThreadsGoals(range: Range): Promise<ThreadsGoals> {
  // ★日付列（@db.Date）とタイムスタンプ列で境界が違う（lib/period.ts）
  const win = range.dateWindow;
  const prevWin = range.prevDateWindow;
  const tsWin = { gte: range.since, lt: range.until };
  const prevTsWin = { gte: range.prev.since, lt: range.prev.until };

  // ★getThreadsData は呼ばない。ここが要るのは「ゴールを狙った投稿」の数字だけで、
  //   全投稿の集計（重い）を引くと、使わない数字が混ざって誤用の元になる。
  const [clickRows, prevClickRows, coverages, dmLeads, prevDmLeads, agencyLeads] =
    await Promise.all([
      prisma.contentMetric.groupBy({
        by: ["metric", "date"],
        where: { metric: { in: Object.values(CLICK_METRIC) }, date: win },
        _sum: { value: true },
      }),
      prisma.contentMetric.groupBy({
        by: ["metric"],
        where: { metric: { in: Object.values(CLICK_METRIC) }, date: prevWin },
        _sum: { value: true },
      }),
      prisma.measurementCoverage.findMany({ select: { metric: true } }),
      // ★DM は受け皿として Lead にも入る（dm_log_import が両方に書く）。
      //   受け皿の実績は Lead が正（/leads・ダッシュボードと数字を合わせる）
      prisma.lead.findMany({
        where: { sourceType: "threads_dm", occurredAt: tsWin },
        select: { occurredAt: true, status: true, closedAmount: true, type: true },
      }),
      prisma.lead.count({ where: { sourceType: "threads_dm", occurredAt: prevTsWin } }),
      // 選別の進み具合は AgencyLead（stage 遷移）が正
      prisma.agencyLead.findMany({
        where: { receivedAt: tsWin },
        select: { stage: true },
      }),
    ]);

  // ★ゴールごとの views は「そのゴールを狙った投稿」のものだけ。
  //   全投稿の views を分母にすると、リンクを貼っていない投稿の表示まで
  //   「送客の母数」に入り、クリック率が実際より低く出る。
  const viewsOfPosts = async (where: object): Promise<number> => {
    const posts = await prisma.contentItem.findMany({
      // ★publishedAt は DateTime。日付列ではないのでタイムスタンプ境界を使う
      where: { type: "post", channel: { type: "threads" }, publishedAt: tsWin, ...where },
      select: { id: true },
    });
    if (posts.length === 0) return 0;
    const rows = await prisma.contentMetric.groupBy({
      by: ["contentItemId"],
      where: {
        contentItemId: { in: posts.map((p) => p.id) },
        metric: "threads_views",
        date: { lt: range.until },
      },
      _max: { value: true },
    });
    return rows.reduce((s2, r) => s2 + Math.round(r._max.value ?? 0), 0);
  };

  const [mediaViews, dmViews] = await Promise.all([
    viewsOfPosts({ url: { contains: "/r/soken/" } }),
    viewsOfPosts({ targetLabel: "代理店候補" }),
  ]);

  /** 成果率（％）。分母0・成果未計測なら null（§16.5） */
  const rateOf = (value: number | null, views: number) =>
    value === null || views <= 0 ? null : Math.round((value / views) * 100000) / 1000;
  const perPostOf = (value: number | null, posts: number) =>
    value === null || posts <= 0 ? null : Math.round((value / posts) * 100) / 100;

  const covered = new Set(coverages.map((c) => c.metric));
  /** 期間内のクリック合計。★一度も計測していない経路は 0 ではなく null（§3） */
  const clicksOf = (goal: string, rows: { metric: string; _sum: { value: number | null } }[]) => {
    const metric = CLICK_METRIC[goal];
    if (!covered.has(metric)) return null;
    return rows
      .filter((r) => r.metric === metric)
      .reduce((s, r) => s + Math.round(r._sum.value ?? 0), 0);
  };

  const postsByGoal = (["media", "dm", "lp", "line", "unset"] as const).map((g) => ({
    goal: g as PostGoal,
    label: GOAL_LABEL[g as PostGoal],
    posts: 0,
  }));
  // getThreadsData は表を返すので、投稿単位の内訳は top ではなく件数から作る
  const goalCounts = await prisma.contentItem.groupBy({
    by: ["url", "targetLabel"],
    where: { type: "post", channel: { type: "threads" }, publishedAt: tsWin },
    _count: { _all: true },
  });
  for (const row of goalCounts) {
    const isAgency = (row.targetLabel ?? "").trim() === "代理店候補";
    const m = row.url ? /\/r\/(soken|lp|line)\//i.exec(row.url) : null;
    const goal: PostGoal = m
      ? m[1].toLowerCase() === "soken"
        ? "media"
        : (m[1].toLowerCase() as "lp" | "line")
      : isAgency
        ? "dm"
        : "unset";
    const t = postsByGoal.find((p) => p.goal === goal);
    if (t) t.posts += row._count._all;
  }
  const postsOf = (g: PostGoal) => postsByGoal.find((p) => p.goal === g)?.posts ?? 0;

  const dmCount = dmLeads.length;
  // ★代理店希望と見込み客を分ける（2026-07-23）。dm-log.md の「反応元」列が
  //   集客投稿なら見込み客として取り込まれる（dm_log_import.py）。
  //   分けないと「代理店18本は多いか少ないか」を DM 実績で決められない。
  const dmAgency = dmLeads.filter((l) => l.type === "agency").length;
  const dmProspect = dmLeads.filter((l) => l.type === "direct_inquiry").length;
  const qualified = agencyLeads.filter((l) =>
    ["qualified", "forwarded", "contracted"].includes(l.stage),
  ).length;
  const contracted = agencyLeads.filter((l) => l.stage === "contracted").length;
  // ★まだ選別が終わっていないDM。0件の「有効」を失敗と読ませないために数える
  const inProgress = agencyLeads.filter((l) =>
    ["received", "screening_sent", "answered"].includes(l.stage),
  ).length;
  const mediaClicks = clicksOf("media", clickRows);

  const goals: GoalCard[] = [
    {
      key: "media",
      label: "① メディア送客",
      posts: postsOf("media"),
      views: mediaViews,
      value: mediaClicks,
      unit: "クリック",
      prev: clicksOf("media", prevClickRows),
      rate: rateOf(mediaClicks, mediaViews),
      perPost: perPostOf(mediaClicks, postsOf("media")),
      note:
        mediaClicks === null
          ? "投稿に /r/soken/ のリンクが1本も無く、計測が始まっていない（0件ではない）"
          : "この先（記事→問い合わせ）は記事側で計測している",
      detailHref: "/content",
    },
    {
      key: "dm",
      label: "② DM（問い合わせ）",
      posts: postsOf("dm"),
      views: dmViews,
      value: dmCount,
      unit: "件",
      prev: prevDmLeads,
      rate: rateOf(dmCount, dmViews),
      perPost: perPostOf(dmCount, postsOf("dm")),
      breakdown: [
        { label: "代理店希望", value: dmAgency, href: "/leads?kind=agency" },
        { label: "見込み客", value: dmProspect, href: "/leads" },
      ],
      // ★2026-07-23 から dm-log.md の「反応元」列で代理店/見込み客を分別できる
      note:
        dmProspect > 0
          ? "代理店希望と見込み客を分けて記録している（dm-log.md の反応元で判定）"
          : "いまの記録はすべて代理店希望。見込み客DMは反応元を『集客…』で書くと分別される",
      detailHref: "/leads?kind=agency",
    },
  ];

  // ── DM の階段（受信 → 選別 → 有効 → 契約）──
  const dmStages: Stage[] = [
    {
      key: "posts",
      label: "① DM狙いの投稿",
      value: postsOf("dm"),
      hint: "代理店募集トラック",
      action: "投稿数を確保する（キュー補充）",
    },
    {
      key: "received",
      // ★③以降は代理店の選別パイプライン（AgencyLead）。分母も代理店DMに揃える。
      //   見込み客DMを分母に入れると「有効率」が実際より低く出る
      label: "② 代理店DM受信",
      value: dmAgency,
      hint: dmProspect > 0 ? `別に見込み客DM ${dmProspect}件（/leads へ）` : "Lead(threads_dm・代理店)",
      action: "アングル・CTA文言を変える",
    },
    {
      key: "qualified",
      // ★選別が終わっていないDMを「有効0件」として落ち込み扱いにしない。
      //   結果がまだ観測されていないのであって、失敗ではない（§3）。
      //   これを 0 と書くと「選別質問を見直せ」という誤った打ち手が出る。
      label: "③ 有効",
      value: qualified === 0 && inProgress > 0 ? null : qualified,
      pendingLabel: "—(結果待ち)",
      hint: inProgress > 0 ? `${inProgress}件が選別中（結果待ち）` : "選別で残った件数",
      action: "選別質問・訴求の対象を見直す",
    },
    {
      key: "contracted",
      label: "④ 契約",
      value: contracted,
      hint: "AgencyLead stage=contracted",
      action: "条件・取次の速度を見直す",
    },
  ];

  // ── メディア送客の階段（投稿 → 表示 → クリック）──
  //   ★この先（記事→問い合わせ）はメディア側の階段。ここで続けない
  const mediaStages: Stage[] = [
    {
      key: "posts",
      label: "① 送客狙いの投稿",
      value: postsOf("media"),
      hint: "/r/soken/ を貼った投稿",
      action: "投稿にリンクを貼る（GASキューの articleLink）",
    },
    {
      key: "views",
      label: "② 表示",
      // ★送客狙いの投稿の views だけ。0投稿なら 0（未計測ではない）
      value: mediaViews,
      hint: "送客リンクを貼った投稿の views",
      action: "効いている型に寄せる",
    },
    {
      key: "clicks",
      label: "③ 記事クリック",
      value: mediaClicks,
      hint: "/r/soken/ のクリック",
      action: "CTA文言・リンクの位置を変える",
    },
  ];

  // ── 推移 ──
  const keys = dayKeys(range.since, range.until);
  const dmByDay = new Map<string, number>();
  for (const l of dmLeads) {
    const k = jstDayKey(l.occurredAt);
    dmByDay.set(k, (dmByDay.get(k) ?? 0) + 1);
  }
  const clickByDay = new Map<string, number>();
  for (const r of clickRows) {
    if (r.metric !== CLICK_METRIC.media) continue;
    const k = jstDayKey(r.date);
    clickByDay.set(k, (clickByDay.get(k) ?? 0) + Math.round(r._sum.value ?? 0));
  }

  const notes: string[] = [];
  if (dmProspect > 0) {
    notes.push(
      `DM ${dmCount}件の内訳は 代理店希望 ${dmAgency}件 / 見込み客 ${dmProspect}件。下の階段（選別 → 契約）は代理店希望の${dmAgency}件だけを分母にしています。`,
    );
  }
  if (inProgress > 0) {
    notes.push(
      `DM ${dmCount}件のうち ${inProgress}件は選別中です。「有効 ${qualified}件」は失敗ではなく、まだ結果が出ていない件数を含みません。`,
    );
  }
  const unset = postsOf("unset");
  if (unset > 0) {
    notes.push(
      `${unset}投稿に送客リンクがありません（狙い未設定）。views は出ていても、どのゴールにも接続していません。GASの投稿キューの articleLink に /r/soken/<投稿ID> を入れると、その日から投稿単位で測れます。`,
    );
  }
  if (mediaClicks === null) {
    notes.push(
      "メディア送客は「0件」ではなく未計測です。リダイレクタ（/r/soken/）は動きますが、まだ一度も踏まれていません。",
    );
  }
  if (dmProspect === 0) {
    // ★2026-07-23 に dm-log.md の「反応元」で分別できるようにした。
    //   それ以前は集客DMがそもそも記録されていない（未計測）
    notes.push(
      "見込み客DMの記録は0件です。dm-log.md の「反応元」列を『集客…』で始めると見込み客として取り込まれます（2026-07-23〜）。それ以前の集客DMは記録がありません。",
    );
  }

  return {
    days: range.days,
    goals,
    dmFlow: buildFlow(dmStages),
    mediaFlow: buildFlow(mediaStages),
    unsetPosts: unset,
    postsByGoal,
    trends: {
      dms: keys.map((k) => ({ date: k, value: dmByDay.get(k) ?? 0 })),
      // ★計測が始まっていないうちは 0 で線を引かない（§3）
      mediaClicks: keys.map((k) => ({
        date: k,
        value: mediaClicks === null ? null : (clickByDay.get(k) ?? 0),
      })),
    },
    notes,
  };
}
