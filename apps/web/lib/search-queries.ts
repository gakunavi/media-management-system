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
