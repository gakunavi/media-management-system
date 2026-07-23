// Threads 実績の集計（設計書 §4.2 /threads・§13.4-④）
//
// ★Threads のゴールは **DM（問い合わせ）**（2026-07-23 石井さん確定）。
//   views・いいね・返信はその手前の数字で、単独では成果ではない。
//   フォーマットの良し悪しも「DMに近づけたか」で見る。
//   → 階段は lib/channel-threads.ts、ここは投稿の効きの集計。
//
// ★データは GAS のスプレッドシートから builtin/threads_sync.py が pull している。
//   MMS は Threads API を叩かない（トークンは GAS 側に置いたまま）。
//
// ★ここでの中心的な注意: **未計測と 0 を混ぜない**（§3）。
//   Insights が回収できていない投稿を views=0 として平均に入れると、
//   平均が下がり「跳ねていない投稿が跳ねて見える」「効いているフォーマットが
//   効いていないように見える」の両方が起きる。未計測は件数として別に出す。
import { prisma } from "@mms/db";
import { jstDayKey, type Range } from "./period";

const METRICS = ["views", "likes", "replies", "reposts", "quotes"] as const;
type MetricKey = (typeof METRICS)[number];

/**
 * 代理店募集トラック（AGC-001）の目印。
 *
 * ★これを集客コンテンツと同じ土俵で比較してはいけない。代理店募集は対象が
 *   狭くviewsは伸びないのが当然で、評価軸はDM獲得であってviewsではない。
 *   混ぜると「A12は低調だから減らせ」という有害な提案が出る（実際に出た）。
 */
const AGENCY_TARGET = "代理店候補";

/**
 * 送客クリックの指標名（遷移先ごと）。
 *
 * ★`threads_link_clicks_lp__setsuzei-diagnosis-a` のような変種別も
 *   同じ接頭辞を持つ。合計に足すと二重計上になるので、明示列挙する。
 *
 * ★遷移先を合算しない。目的が違うので、合計だけだと
 *   「どの型がLINEに送ったか」が出ない。LINE登録は follow イベントに
 *   経路情報が入らないため（LINE の仕様）、投稿別の貢献は
 *   このクリック数でしか近似できない。
 */
export const LINK_DESTS = [
  { key: "soken", label: "節税総研", metric: "threads_link_clicks_soken" },
  { key: "lp", label: "診断LP", metric: "threads_link_clicks_lp" },
  { key: "line", label: "公式LINE", metric: "threads_link_clicks_line" },
] as const;

const LINK_CLICK_METRICS = LINK_DESTS.map((d) => d.metric);

export type ThreadsPost = {
  id: string;
  externalId: string;
  title: string;
  format: string;
  target: string | null;
  coreMessage: string | null;
  publishedAt: Date | null;
  /** null = 未計測（Insights 未回収）。0 とは意味が違う */
  views: number | null;
  engagement: number | null;
  /** 送客クリック（リンクを貼っていない投稿は 0） */
  clicks: number;
  /** 遷移先ごとの内訳。soken / lp / line */
  clicksByDest: Record<string, number>;
  /** 投稿に貼った送客リンク。null なら導線なし */
  linkUrl: string | null;
  /** 内訳。null は未計測（§3）。quotes は実測0が続いているので合計にのみ含める */
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  /** 代理店募集トラック。集客コンテンツとは評価軸が違う */
  isAgency: boolean;
  /** その投稿が狙ったゴール。判定は貼ったリンク（2026-07-23 石井さん確定） */
  goal: PostGoal;
};

/**
 * 投稿のゴール。
 *
 * ★Threads のゴールは1本の階段ではなく**並列**（2026-07-23 石井さん）。
 *     media … メディア（記事）へ送る。問い合わせは記事側で取る
 *     dm    … Threads内で直接DMをもらう
 *   これを1つのファネルとして縦に並べると、DM狙いの投稿が
 *   「送客していない」と評価され、逆も起きる。別々に数える。
 *
 * ★判定は**貼ったリンク**。狙いを別の列で自己申告させると、
 *   実際に貼ったものとズレたときに嘘の分類が残る。
 *     /r/soken/ → media ／ /r/lp/ → lp ／ /r/line/ → line
 *     リンク無し＋代理店候補 → dm
 *     リンク無し＋集客       → unset（狙いが設定されていない）
 */
export type PostGoal = "media" | "lp" | "line" | "dm" | "unset";

export const GOAL_LABEL: Record<PostGoal, string> = {
  media: "メディア送客",
  lp: "診断LP送客",
  line: "公式LINE送客",
  dm: "DM（問い合わせ）",
  unset: "狙い未設定",
};

/** リンクからゴールを判定する。/r/<dest>/<postId> の dest を見る */
export function goalOfLink(url: string | null, isAgency: boolean): PostGoal {
  const m = url ? /\/r\/(soken|lp|line)\//i.exec(url) : null;
  if (m) {
    const dest = m[1].toLowerCase();
    return dest === "soken" ? "media" : (dest as "lp" | "line");
  }
  // ★リンクが無くても、代理店募集はDMを取りに行く投稿。狙いは決まっている
  if (isAgency) return "dm";
  return "unset";
}

export type GroupStat = {
  name: string;
  posts: number;
  /** 計測できている投稿数。posts との差が未計測 */
  measured: number;
  avgViews: number | null;
  avgEngagement: number | null;
  totalViews: number;

  // ── 反応の内訳 ────────────────────────────────
  //  ★views だけで並べると順位が実態とずれる。2026-07-22 の実測で
  //    質問型は views 1位・いいね率11位・返信数2位だった。
  //    「反応が良い」の定義によって勝つフォーマットが変わる。
  totalLikes: number;
  totalReplies: number;
  totalReposts: number;
  /** いいね ÷ views（％）。反応が少なすぎるときは null（§16.5） */
  likeRate: number | null;
  /** 1投稿あたりの返信数。会話が始まった度合い＝DM に最も近い指標 */
  repliesPerPost: number | null;

  /**
   * 送客クリック数（節税総研 / 診断LP / 公式LINE の合計）。
   * ★4つの目的のうち2つ（LP送客・LINE送客）に直接対応する唯一の実測値。
   *   リンクを貼った投稿がまだ無い間は 0 が並ぶが、これは「導線が無い」であって
   *   「効かなかった」ではない。linkedPosts と併せて読むこと。
   */
  clicks: number;
  /** 遷移先ごとの内訳。soken / lp / line */
  clicksByDest: Record<string, number>;
  /** そのグループでリンクを貼った投稿数。0 なら clicks=0 は当然 */
  linkedPosts: number;
  /**
   * 少数グループをまとめた行か。
   * ★型が混ざるので平均・率は出さない。畳んだ行の平均は「何の平均でもない」。
   */
  isOther: boolean;
};

/** 表ごとの集計結果。倍率の基準（中央値）は**その表の中**で求める */
export type GroupTable = {
  rows: GroupStat[];
  /** その表の平均views の中央値。倍率の分母 */
  median: number | null;
};

export type ThreadsSummary = {
  posts: number;
  measured: number;
  unmeasured: number;
  /** 代理店募集トラックの投稿数（フォーマット比較からは除外している） */
  agencyPosts: number;
  totalViews: number;
  avgViews: number | null;
  /** 全フォーマットの平均viewsの中央値。個別フォーマットの良し悪しの基準 */
  medianFormatAvg: number | null;
  firstPostedAt: Date | null;
  lastPostedAt: Date | null;
  /** 送客リンクを貼った投稿数。0 なら送客クリック0は「導線が無い」だけ */
  linkedPosts: number;
  /** 送客クリック合計（期間内） */
  clicks: number;
  days: number;
};

export type ThreadsData = {
  summary: ThreadsSummary;
  /**
   * 集客コンテンツの集計（★代理店トラックは全表から除外する）。
   * ★旧実装は byFormat だけ代理店を除外し、byTarget / byCore には混ぜていた。
   *   さらに3つの表すべてが「フォーマット別の中央値」を倍率の分母に使っており、
   *   母集団の違う数字を同じ基準で割っていた（代理店候補 ×0.1 など）。
   *   表ごとに自分の中央値を持たせ、混入も断つ。
   */
  byFormat: GroupTable;
  byTarget: GroupTable;
  byCore: GroupTable;
  /** 代理店募集トラックの angle 別。viewsでの優劣判断はしない（評価軸はDM） */
  byAgencyAngle: GroupTable;
  top: ThreadsPost[];
};

/** 集計に足る母数。これ未満のグループは平均を出さない（§16.5 の考え方） */
export const MIN_POSTS_FOR_STAT = 10;

/**
 * いいね率を出すのに必要な、そのグループの合計いいね数（§16.5）。
 *
 * ★2026-07-22 の実測: 579投稿で いいね計 約400・返信計 約110。
 *   いいねが付いた投稿は 166/579、返信が付いた投稿は 44/579 しかない。
 *   この粗さで率を出すと、いいね3件（A12）の 0.39% が
 *   いいね120件（あるある型）の 0.31% より上に並ぶ。
 *   件数が足りないものは「不明」であって「優秀」ではない。
 */
export const MIN_ENGAGEMENTS_FOR_RATE = 10;

/**
 * フォーマット名の正規化。
 *
 * ★実測で「早口 | champion」のような実験マーカー付きの型名が混ざっていた。
 *   これを別の型として数えると、同じ型の実績が2行に割れて母数不足になり、
 *   どちらも「母数不足」で消える。マーカーは型名ではないので落とす。
 *
 * ★意味での寄せ（「あるある共感」→「あるある型」など）はしない。
 *   似た名前を機械が同一視すると、別物を混ぜた平均を「実績」として出すことになる。
 *   表記ゆれは少数行として畳み、名寄せは人が決める。
 */
export function normalizeFormat(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "未設定";
  return s.split("|")[0].trim() || "未設定";
}

/** これ未満の投稿数のグループは「その他」に畳む。実験名・打ち間違いが行を埋めるため */
const FOLD_UNDER_POSTS = 5;

export async function getThreadsData(range: Range): Promise<ThreadsData> {
  // ★期間で絞る。旧実装は全期間（5/7〜・586投稿）を1つに混ぜて平均していたため、
  //   「今月どの型が効いているか」が読めなかった。
  const items = await prisma.contentItem.findMany({
    where: {
      type: "post",
      channel: { type: "threads" },
      publishedAt: { gte: range.since, lt: range.until },
    },
    select: {
      id: true,
      externalId: true,
      title: true,
      note: true,
      targetLabel: true,
      category: true,
      publishedAt: true,
      url: true,
    },
  });

  const ids = items.map((i) => i.id);
  // ★views は累積値。期間末までに記録された最大値を「その期間の実績」とする。
  //   期間で date を切らないと、過去期間を見たときに未来の値が入る。
  const metrics = ids.length
    ? await prisma.contentMetric.groupBy({
        by: ["contentItemId", "metric"],
        where: {
          contentItemId: { in: ids },
          metric: { in: METRICS.map((m) => `threads_${m}`) },
          // ★@db.Date 列（lib/period.ts）
          date: { lt: range.dateWindow.lt },
        },
        _max: { value: true },
      })
    : [];

  // ★送客クリックは views と違って日次で積み上がる（最大値ではなく合計）。
  //   変種別（__setsuzei-diagnosis-a 等）は内訳なので二重に数えない
  const clickRows = ids.length
    ? await prisma.contentMetric.groupBy({
        by: ["contentItemId", "metric"],
        where: {
          contentItemId: { in: ids },
          metric: { in: LINK_CLICK_METRICS },
          date: range.dateWindow,
        },
        _sum: { value: true },
      })
    : [];
  const clicksByItem = new Map<string, number>();
  const destByItem = new Map<string, Record<string, number>>();
  for (const r of clickRows) {
    const dest = LINK_DESTS.find((d) => d.metric === r.metric)?.key;
    if (!dest) continue;
    const v = r._sum.value ?? 0;
    clicksByItem.set(r.contentItemId, (clicksByItem.get(r.contentItemId) ?? 0) + v);
    const cur = destByItem.get(r.contentItemId) ?? {};
    cur[dest] = (cur[dest] ?? 0) + v;
    destByItem.set(r.contentItemId, cur);
  }

  const byItem = new Map<string, Partial<Record<MetricKey, number>>>();
  for (const m of metrics) {
    const key = m.metric.replace(/^threads_/, "") as MetricKey;
    const cur = byItem.get(m.contentItemId) ?? {};
    cur[key] = m._max.value ?? 0;
    byItem.set(m.contentItemId, cur);
  }

  const posts: ThreadsPost[] = items.map((it) => {
    const m = byItem.get(it.id);
    // ★ContentMetric の行が無い＝未計測。views:null で表現し、0 と区別する
    const views = m?.views ?? null;
    const engagement =
      m === undefined
        ? null
        : (m.likes ?? 0) + (m.replies ?? 0) + (m.reposts ?? 0) + (m.quotes ?? 0);
    return {
      id: it.id,
      externalId: it.externalId,
      title: it.title,
      format: normalizeFormat(it.note),
      target: it.targetLabel,
      coreMessage: it.category,
      publishedAt: it.publishedAt,
      views,
      engagement,
      clicks: clicksByItem.get(it.id) ?? 0,
      clicksByDest: destByItem.get(it.id) ?? {},
      linkUrl: it.url,
      likes: m?.likes ?? null,
      replies: m?.replies ?? null,
      reposts: m?.reposts ?? null,
      isAgency: (it.targetLabel ?? "").trim() === AGENCY_TARGET,
      goal: goalOfLink(it.url, (it.targetLabel ?? "").trim() === AGENCY_TARGET),
    };
  });

  // ★代理店募集トラックは全ての表から外す。評価軸がDM獲得で、
  //   集客コンテンツと同じ土俵（views）で比べると有害な提案が出る（実際に出た）。
  //   旧実装は byFormat だけ外し、ターゲット別・コアメッセージ別には混ぜていた。
  const contentPosts = posts.filter((p) => !p.isAgency);
  const agencyPosts = posts.filter((p) => p.isAgency);

  const measuredPosts = posts.filter((p) => p.views !== null);
  const totalViews = measuredPosts.reduce((s, p) => s + (p.views ?? 0), 0);
  const dates = posts
    .map((p) => p.publishedAt)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime());

  const byFormat = buildTable(contentPosts, (p) => p.format);

  return {
    summary: {
      posts: posts.length,
      measured: measuredPosts.length,
      unmeasured: posts.length - measuredPosts.length,
      agencyPosts: agencyPosts.length,
      totalViews,
      avgViews: measuredPosts.length ? Math.round(totalViews / measuredPosts.length) : null,
      medianFormatAvg: byFormat.median,
      firstPostedAt: dates[0] ?? null,
      lastPostedAt: dates[dates.length - 1] ?? null,
      // ★送客リンクを貼った投稿。0 なら「効かなかった」ではなく導線が無い
      linkedPosts: posts.filter((p) => p.linkUrl).length,
      clicks: posts.reduce((s, p) => s + p.clicks, 0),
      days: range.days,
    },
    byFormat,
    byTarget: buildTable(contentPosts, (p) => p.target?.trim() || "未設定"),
    byCore: buildTable(contentPosts, (p) => p.coreMessage?.trim() || "未設定"),
    byAgencyAngle: buildTable(agencyPosts, (p) => p.format),
    top: [...measuredPosts].sort((a, b) => (b.views ?? 0) - (a.views ?? 0)).slice(0, 15),
  };
}

/**
 * 表を1つ作る。倍率の基準（中央値）は**この表の中**で求める。
 *
 * ★旧実装は3つの表すべてが「フォーマット別の中央値」を分母にしていた。
 *   母集団の違う数字を同じ基準で割ると、意味の無い倍率が並ぶ。
 */
function buildTable(posts: ThreadsPost[], key: (p: ThreadsPost) => string): GroupTable {
  const rows = groupBy(posts, key);
  const avgs = rows
    .filter((g) => !g.isOther && g.avgViews !== null)
    .map((g) => g.avgViews as number)
    .sort((a, b) => a - b);
  return {
    rows,
    median: avgs.length ? Math.round(avgs[Math.floor(avgs.length / 2)]) : null,
  };
}

function groupBy(posts: ThreadsPost[], key: (p: ThreadsPost) => string): GroupStat[] {
  const map = new Map<string, ThreadsPost[]>();
  for (const p of posts) {
    const k = key(p);
    const arr = map.get(k);
    if (arr) arr.push(p);
    else map.set(k, [p]);
  }

  // ★1〜数件しかないグループを畳む。実測では「test」「出題型クイズ」など
  //   1〜2投稿の行が11行並び、本番の型と同列に見えていた。
  //   捨てずに「その他」へまとめる（消すと投稿数の合計が合わなくなる）。
  const folded: ThreadsPost[] = [];
  let foldedGroups = 0;
  for (const [name, arr] of [...map.entries()]) {
    if (arr.length < FOLD_UNDER_POSTS && map.size > 1) {
      folded.push(...arr);
      foldedGroups += 1;
      map.delete(name);
    }
  }

  const out: GroupStat[] = [];
  for (const [name, arr] of map) {
    const measured = arr.filter((p) => p.views !== null);
    const totalViews = measured.reduce((s, p) => s + (p.views ?? 0), 0);
    const totalEng = measured.reduce((s, p) => s + (p.engagement ?? 0), 0);
    const totalLikes = measured.reduce((s, p) => s + (p.likes ?? 0), 0);
    const totalReplies = measured.reduce((s, p) => s + (p.replies ?? 0), 0);
    const totalReposts = measured.reduce((s, p) => s + (p.reposts ?? 0), 0);
    // ★送客は未計測の概念が無い（クリックされなければ0）。measured で絞らない
    const clicks = arr.reduce((s, p) => s + p.clicks, 0);
    const clicksByDest: Record<string, number> = {};
    for (const p of arr) {
      for (const [k, v] of Object.entries(p.clicksByDest)) {
        clicksByDest[k] = (clicksByDest[k] ?? 0) + v;
      }
    }
    const linkedPosts = arr.filter((p) => p.linkUrl).length;
    out.push({
      name,
      posts: arr.length,
      measured: measured.length,
      // ★母数が小さいグループは平均を出さない。1〜2件の平均で判断させない
      avgViews:
        measured.length >= MIN_POSTS_FOR_STAT ? Math.round(totalViews / measured.length) : null,
      avgEngagement:
        measured.length >= MIN_POSTS_FOR_STAT
          ? Math.round((totalEng / measured.length) * 10) / 10
          : null,
      totalViews,
      totalLikes,
      totalReplies,
      totalReposts,
      // ★反応そのものが少ないうちは率を出さない。いいね3件の 0.39% と
      //   いいね120件の 0.31% を並べると、前者が上に来て判断を誤る（§16.5）
      likeRate:
        totalLikes >= MIN_ENGAGEMENTS_FOR_RATE && totalViews > 0
          ? Math.round((totalLikes / totalViews) * 10000) / 100
          : null,
      repliesPerPost:
        measured.length >= MIN_POSTS_FOR_STAT
          ? Math.round((totalReplies / measured.length) * 100) / 100
          : null,
      clicks,
      clicksByDest,
      linkedPosts,
      isOther: false,
    });
  }

  // 平均が出せるものを上に、その中で平均views降順
  out.sort((a, b) => {
    if (a.avgViews === null && b.avgViews === null) return b.posts - a.posts;
    if (a.avgViews === null) return 1;
    if (b.avgViews === null) return -1;
    return b.avgViews - a.avgViews;
  });

  if (folded.length > 0) {
    const measured = folded.filter((p) => p.views !== null);
    const clicksByDest: Record<string, number> = {};
    for (const p of folded) {
      for (const [k, v] of Object.entries(p.clicksByDest)) {
        clicksByDest[k] = (clicksByDest[k] ?? 0) + v;
      }
    }
    out.push({
      name: `その他（${foldedGroups}種・各${FOLD_UNDER_POSTS}投稿未満）`,
      posts: folded.length,
      measured: measured.length,
      // ★中身が別の型なので平均・率は出さない。畳んだ行の平均は何の平均でもない
      avgViews: null,
      avgEngagement: null,
      totalViews: measured.reduce((s, p) => s + (p.views ?? 0), 0),
      totalLikes: measured.reduce((s, p) => s + (p.likes ?? 0), 0),
      totalReplies: measured.reduce((s, p) => s + (p.replies ?? 0), 0),
      totalReposts: measured.reduce((s, p) => s + (p.reposts ?? 0), 0),
      likeRate: null,
      repliesPerPost: null,
      clicks: folded.reduce((s, p) => s + p.clicks, 0),
      clicksByDest,
      linkedPosts: folded.filter((p) => p.linkUrl).length,
      isOther: true,
    });
  }
  return out;
}


// ── アカウントの健全性（§2454 SnsAccountHealth・配信制限の検知）──

export type HealthRow = {
  date: Date;
  followers: number;
  followersDelta: number;
  postsDelivered: number;
  avgViews: number | null;
  viewsPerFollower: number | null;
  restrictionSuspected: boolean;
};

export type AccountHealth = {
  rows: HealthRow[];
  latest: HealthRow | null;
  /** 基準線を引けるだけの履歴があるか。無いうちは「異常なし」と言ってはいけない */
  hasBaseline: boolean;
  /** 判定に必要な日数（UIで残り日数を出すため） */
  minDays: number;
  suspectedDays: number;
  /** SnsAccountHealth の行数。日次記録そのものが何日分あるか */
  historyDays: number;
};

/** 基準線に要る日数。route.ts の RESTRICTION_MIN_HISTORY_DAYS と揃える */
export const HEALTH_MIN_DAYS = 7;

export async function getAccountHealth(now: Date = new Date()): Promise<AccountHealth> {
  const rows = await prisma.snsAccountHealth.findMany({
    where: { channel: { type: "threads" } },
    orderBy: { date: "desc" },
    take: 60,
    select: {
      date: true,
      followers: true,
      followersDelta: true,
      postsDelivered: true,
      avgViews: true,
      viewsPerFollower: true,
      restrictionSuspected: true,
    },
  });

  // ★avgViews / viewsPerFollower は GAS が入れる前提だったが、実測では
  //   全行 NULL のままで「履歴 0/7日・判定不能」が固定表示になっていた。
  //   待っても埋まらないのに「あと7日」と読めるのは嘘に近い。
  //   材料（その日に公開した投稿の views と followers）は MMS 側にある。
  //   自前で埋める。GAS が値を入れてきたらそちらを優先する。
  const oldest = rows.length ? rows[rows.length - 1].date : null;
  const dayViews = oldest
    ? await prisma.contentItem.findMany({
        where: {
          type: "post",
          channel: { type: "threads" },
          publishedAt: { gte: oldest },
        },
        select: {
          publishedAt: true,
          metrics: {
            where: { metric: "threads_views" },
            orderBy: { value: "desc" },
            take: 1,
            select: { value: true },
          },
        },
      })
    : [];

  const byDay = new Map<string, { sum: number; n: number }>();
  for (const p of dayViews) {
    const v = p.metrics[0]?.value;
    // ★未計測の投稿を 0 として平均に入れない（§3）
    if (v === undefined || !p.publishedAt) continue;
    const k = jstDayKey(p.publishedAt);
    const cur = byDay.get(k) ?? { sum: 0, n: 0 };
    cur.sum += v;
    cur.n += 1;
    byDay.set(k, cur);
  }

  const filled: HealthRow[] = rows.map((r) => {
    if (r.avgViews !== null && r.viewsPerFollower !== null) return r;
    const d = byDay.get(jstDayKey(r.date));
    const avgViews = r.avgViews ?? (d && d.n > 0 ? Math.round(d.sum / d.n) : null);
    return {
      ...r,
      avgViews,
      viewsPerFollower:
        r.viewsPerFollower ??
        (avgViews !== null && r.followers > 0
          ? Math.round((avgViews / r.followers) * 100) / 100
          : null),
    };
  });

  const measured = filled.filter((r) => r.viewsPerFollower !== null).length;
  return {
    rows: filled,
    latest: filled[0] ?? null,
    hasBaseline: measured >= HEALTH_MIN_DAYS,
    minDays: HEALTH_MIN_DAYS,
    suspectedDays: filled.filter((r) => r.restrictionSuspected).length,
    /** ★何日分の記録があるか。「7日待てば埋まる」かを判断する材料 */
    historyDays: rows.length,
  };
}
