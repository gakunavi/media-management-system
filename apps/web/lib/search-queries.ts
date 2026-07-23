// 記事が「実際に何で検索されて表示されたか」（GSC page×query）
//
// ★なぜ要るか
//   記事の目的は送客だが、その手前に「検索で見つかる」がある。
//   これまで持っていたのは記事単位の合計（clicks / impressions / position）だけで、
//   **どの検索語で戦っているか**が無かった。合計だけでは打ち手が決まらない:
//     ・順位は良いのに押されない → タイトル/説明文の問題
//     ・11〜20位で表示が多い     → あと一押しで1ページ目（striking distance）
//     ・同じ語で複数記事が上位   → カニバリ。統合するか役割を分ける
//   これらは全部「記事×検索語」でしか出せない。
//
// ★position は GSC の期間平均。加重平均ではないので**合算してはいけない**。
// ★未計測（取得していない）と実測ゼロ（表示されていない）を混同しない（§3）。
import { prisma } from "@mms/db";
import { decodeEntities } from "./content";

/** striking distance の定義（§13.3）。あと一押しで1ページ目に入る帯 */
export const STRIKING_MIN = 11;
export const STRIKING_MAX = 20;

/**
 * 「表示は多いのに押されない」と判定する下限。
 * ★母数が無いと率は出さない（§16.5）。表示が少ないKWのCTRは偶然で跳ねる。
 */
const LOW_CTR_MIN_IMPRESSIONS = 100;
/** 1ページ目に居るのに押されていない、と言える上限順位 */
const LOW_CTR_MAX_POSITION = 10;

/**
 * 「CTR不全」＝ 実運用でリライト着手の最多トリガ（cowork 実績・2026-07-23）。
 *
 * ★"順位が落ちた" ではなく **"順位は取れているのにクリック0"** が主トリガ。
 *   intervention 9件の実績がこの形だった。PRJ-026 の判定は「順位11〜25位帯×
 *   表示あり×低CTR」で、cowork の実感は 10〜14位。
 *   ここは**両方を含む 10〜25位**にし、表示があってクリック0のものを拾う。
 *   狭くすると取りこぼし、広くすると処理能力（週2〜3本）を超える。
 */
export const CTR_FAIL_MIN_POSITION = 10;
export const CTR_FAIL_MAX_POSITION = 25;
/** 表示がこれ未満だと「押されていない」と言えない（§16.5 母数） */
export const CTR_FAIL_MIN_IMPRESSIONS = 20;

/**
 * リライト直後は評価しない期間（日）。効果測定は28日後（cowork 実運用）。
 * ★`Intervention` が無い記事のための保険。**通常は `Intervention.evaluateAt` を使う**
 *   （そちらのほうが正確で、実施日も評価日も実データで入っている）。
 */
export const REWRITE_COOLDOWN_DAYS = 28;

/**
 * 公的機関を名指しした検索語。
 *
 * ★これを分けないと打ち手を誤る。実測（2026-07-23）で「押されていない」上位は
 *   ほぼ「国税庁 青色申告特別控除 65万円」型で、3.9〜6.6位・計445表示・0クリック だった。
 *   利用者は国税庁の公式ページを開きに来ているので、**こちらのタイトルを直しても
 *   クリックは増えない**。「タイトルが悪い」と読ませると無駄な作業が発生する。
 */
const NAVIGATIONAL = ["国税庁", "中小企業庁", "経済産業省", "財務省", "日本政策金融公庫", "中小機構"];

export function isNavigational(query: string): boolean {
  return NAVIGATIONAL.some((n) => query.includes(n));
}

export type QueryRow = {
  query: string;
  /** 公的機関を名指しした検索語。順位が良くても押されないのが普通 */
  navigational: boolean;
  externalId: string;
  title: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
};

export type CannibalGroup = {
  query: string;
  impressions: number;
  items: { externalId: string; title: string; clicks: number; impressions: number; position: number | null }[];
};

export type QueryInsights = {
  /** 取得しているか。false のとき 0 を「表示されていない」と読んではいけない */
  measured: boolean;
  periodStart: Date | null;
  periodEnd: Date | null;
  totalQueries: number;
  articlesWithQueries: number;
  /** あと一押しで1ページ目（11〜20位）。表示の多い順 */
  striking: QueryRow[];
  /** 1ページ目に居るのに押されていない。タイトル/説明文の打ち手 */
  lowCtr: QueryRow[];
  /** そのうち公的機関の指名検索（＝直しても増えない）の本数 */
  lowCtrNavigational: number;
  /** 同じ検索語で複数記事が表示されている（カニバリ） */
  cannibals: CannibalGroup[];
};

type Raw = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number | null;
  position: number | null;
  contentItem: { externalId: string; title: string };
};

const toRow = (r: Raw): QueryRow => ({
  query: r.query,
  navigational: isNavigational(r.query),
  externalId: r.contentItem.externalId,
  title: decodeEntities(r.contentItem.title),
  clicks: r.clicks,
  impressions: r.impressions,
  ctr: r.ctr,
  position: r.position,
});

export async function getQueryInsights(): Promise<QueryInsights> {
  // ★最新の集計期間だけを見る。古い期間が混ざると同じ語が二重に並ぶ
  const latest = await prisma.contentQuery.findFirst({
    orderBy: { periodEnd: "desc" },
    select: { periodStart: true, periodEnd: true },
  });
  if (!latest) {
    return {
      measured: false,
      periodStart: null,
      periodEnd: null,
      totalQueries: 0,
      articlesWithQueries: 0,
      striking: [],
      lowCtr: [],
      lowCtrNavigational: 0,
      cannibals: [],
    };
  }

  const rows = (await prisma.contentQuery.findMany({
    where: { periodEnd: latest.periodEnd, periodStart: latest.periodStart },
    select: {
      query: true,
      clicks: true,
      impressions: true,
      ctr: true,
      position: true,
      contentItem: { select: { externalId: true, title: true } },
    },
  })) as Raw[];

  const striking = rows
    .filter(
      (r) =>
        r.position !== null && r.position >= STRIKING_MIN && r.position <= STRIKING_MAX,
    )
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 25)
    .map(toRow);

  const lowCtr = rows
    .filter(
      (r) =>
        r.impressions >= LOW_CTR_MIN_IMPRESSIONS &&
        r.position !== null &&
        r.position <= LOW_CTR_MAX_POSITION,
    )
    .sort((a, b) => (a.ctr ?? 1) - (b.ctr ?? 1))
    .slice(0, 20)
    .map(toRow)
    // ★直せるものを上に出す。指名検索は下へ回す（消しはしない・実態は実態）
    .sort((a, b) => Number(a.navigational) - Number(b.navigational));

  // ── カニバリ: 同じ検索語で2記事以上が表示されている ──
  //   ★表示があるだけでは弱いので、合計表示が一定以上のものだけ出す。
  //     1表示ずつの偶然を「カニバリ」と呼ぶと、直す価値の無い指摘が並ぶ。
  const byQuery = new Map<string, Raw[]>();
  for (const r of rows) {
    const g = byQuery.get(r.query);
    if (g) g.push(r);
    else byQuery.set(r.query, [r]);
  }
  const cannibals: CannibalGroup[] = [];
  for (const [query, group] of byQuery) {
    if (group.length < 2) continue;
    const impressions = group.reduce((s, r) => s + r.impressions, 0);
    if (impressions < 30) continue;
    cannibals.push({
      query,
      impressions,
      items: group
        .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions)
        .map((r) => ({
          externalId: r.contentItem.externalId,
          title: decodeEntities(r.contentItem.title),
          clicks: r.clicks,
          impressions: r.impressions,
          position: r.position,
        })),
    });
  }
  cannibals.sort((a, b) => b.impressions - a.impressions);

  return {
    measured: true,
    periodStart: latest.periodStart,
    periodEnd: latest.periodEnd,
    totalQueries: rows.length,
    articlesWithQueries: new Set(rows.map((r) => r.contentItem.externalId)).size,
    striking,
    lowCtr,
    lowCtrNavigational: lowCtr.filter((r) => r.navigational).length,
    cannibals: cannibals.slice(0, 15),
  };
}

/**
 * CTR不全の記事ID → 根拠（最も表示の多い該当検索語）。
 *
 * ★鮮度の期限「だけ」で督促すると、処理能力を超えた瞬間に誰も見なくなる。
 *   期限は境界に留め、**CTR不全と重なった記事を先に出す**（二段構え）。
 */
export type CtrFailure = {
  query: string;
  position: number;
  impressions: number;
  /**
   * 同じ検索語で表示されている**他の**記事。
   * ★ここが空かどうかで打ち手が変わる（cowork 指摘・2026-07-23）。
   *     空でない → カニバリ。タイトルを直しても互いに食い合ったまま。
   *                本命を決めて KW を分け、内部リンクを本命へ寄せる
   *     空       → 単記事のCTR不全。タイトル・説明文を即答型に直す
   *   実測では残った督促3本が**全部カニバリ**だった。既定文面のままだと
   *   3本とも効かない指示を出すところだった。
   */
  rivals: { externalId: string; position: number; impressions: number }[];
};

/** 競合とみなす表示回数の下限。1〜2表示の偶然を競合と呼ばない */
const RIVAL_MIN_IMPRESSIONS = 5;

export async function getCtrFailures(): Promise<Map<string, CtrFailure>> {
  const latest = await prisma.contentQuery.findFirst({
    orderBy: { periodEnd: "desc" },
    select: { periodStart: true, periodEnd: true },
  });
  if (!latest) return new Map();
  // ★実着手できない記事を除く（cowork 指摘・2026-07-23）
  //   ① 統合済み/301済み … 直す実体が無い。URLを持たないプレースホルダで判別する
  //      （実測で ART-006 が毎回上位に出ていた）
  //   ② 効果測定の待ち中 … 直した記事をすぐ再掲すると同じ記事を無限に触る
  //
  // ★②は `lastReviewedAt` では判定できない。
  //   「cosmetic更新は逆効果・実質追記のときだけ dateModified を更新する」が
  //   既存ルールなので、**タイトル/メタだけ直した記事は最終更新日が動かない**。
  //   まさに我々が推奨している直し方がそれ。実際 ART-058 は 7/3 にリライト済なのに
  //   最終更新日は 4/23 のままで、除外できずに再掲されていた。
  //   `Intervention.evaluateAt`（実施日＋28日）が実データで入っているのでそれを使う。
  const now = new Date();
  const pending = await prisma.intervention.findMany({
    where: { evaluateAt: { gt: now }, contentItemId: { not: null } },
    select: { contentItemId: true },
  });
  const waiting = new Set(pending.map((p) => p.contentItemId as string));

  const cooldown = new Date(now.getTime() - REWRITE_COOLDOWN_DAYS * 86400000);
  const rows = await prisma.contentQuery.findMany({
    where: {
      periodStart: latest.periodStart,
      periodEnd: latest.periodEnd,
      clicks: 0,
      impressions: { gte: CTR_FAIL_MIN_IMPRESSIONS },
      position: { gte: CTR_FAIL_MIN_POSITION, lte: CTR_FAIL_MAX_POSITION },
      contentItem: {
        url: { not: null },
        // Intervention が無い記事のための保険
        OR: [{ lastReviewedAt: null }, { lastReviewedAt: { lt: cooldown } }],
      },
    },
    orderBy: { impressions: "desc" },
    select: { contentItemId: true, query: true, position: true, impressions: true },
  });
  const out = new Map<string, CtrFailure>();
  for (const r of rows) {
    if (waiting.has(r.contentItemId)) continue; // 効果測定の待ち中
    // ★指名検索（「国税庁 …」）を根拠にしない。§4-24 のとおり
    //   利用者は公式ページを開きに来ているので、タイトルを直してもクリックは増えない。
    //   /keywords では下へ回しているのに督促では拾っていた（不整合だった）。
    //   これしか根拠が無い記事は督促に出さない。
    if (isNavigational(r.query)) continue;
    // 表示の多い順に見るので、最初に入ったものが最も強い根拠
    if (!out.has(r.contentItemId)) {
      out.set(r.contentItemId, {
        query: r.query,
        position: r.position ?? 0,
        impressions: r.impressions,
        rivals: [],
      });
    }
  }

  // ★根拠の検索語ごとに、同じ語で出ている他の記事を引く。
  //   これが打ち手の分岐になるので、件数が少なくても必ず調べる。
  const queries = [...new Set([...out.values()].map((v) => v.query))];
  if (queries.length > 0) {
    const all = await prisma.contentQuery.findMany({
      where: {
        periodStart: latest.periodStart,
        periodEnd: latest.periodEnd,
        query: { in: queries },
        impressions: { gte: RIVAL_MIN_IMPRESSIONS },
      },
      orderBy: { impressions: "desc" },
      select: {
        contentItemId: true,
        query: true,
        position: true,
        impressions: true,
        contentItem: { select: { externalId: true } },
      },
    });
    for (const [cid, v] of out) {
      v.rivals = all
        .filter((a) => a.query === v.query && a.contentItemId !== cid)
        .map((a) => ({
          externalId: a.contentItem.externalId,
          position: a.position ?? 0,
          impressions: a.impressions,
        }));
    }
  }
  return out;
}

/** 記事詳細用。その記事が実際に来ている検索語（クリックの多い順） */
export async function getQueriesForContent(contentItemId: string): Promise<QueryRow[]> {
  const latest = await prisma.contentQuery.findFirst({
    where: { contentItemId },
    orderBy: { periodEnd: "desc" },
    select: { periodStart: true, periodEnd: true },
  });
  if (!latest) return [];
  const rows = (await prisma.contentQuery.findMany({
    where: { contentItemId, periodEnd: latest.periodEnd, periodStart: latest.periodStart },
    orderBy: [{ clicks: "desc" }, { impressions: "desc" }],
    take: 30,
    select: {
      query: true,
      clicks: true,
      impressions: true,
      ctr: true,
      position: true,
      contentItem: { select: { externalId: true, title: true } },
    },
  })) as Raw[];
  return rows.map(toRow);
}
