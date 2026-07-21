// キーワード一覧・順位分布（設計書 §4.2 /keywords・§13.3・§3.3.3）
//
// 既存データ（P1移行）: Keyword 360件、KeywordRanking 週次5スナップショット。
//   ★volume / difficulty / 割当記事 / 鮮度 は未取得（ラッコ＝P4.5/P4.10・割当＝P4.5）。
//   いま出せるのは「現在順位・前週差・クリック・表示・CTR・順位帯」。
import { prisma } from "@mms/db";

export type Band = "top3" | "top10" | "striking" | "out";

export function bandOf(position: number | null): Band | null {
  if (position === null) return null;
  if (position <= 3) return "top3";
  if (position <= 10) return "top10";
  if (position <= 20) return "striking"; // ★11-20位 = striking distance（§13.3）
  return "out";
}

export const BAND_LABEL: Record<Band, string> = {
  top3: "1-3位",
  top10: "4-10位",
  striking: "11-20位",
  out: "21位〜",
};

export type KeywordRow = {
  id: string;
  keyword: string;
  position: number | null; // 最新スナップショットの順位
  positionDelta: number | null; // 前スナップショット比（+ が改善）
  clicks: number;
  impressions: number;
  ctr: number | null;
  band: Band | null;
  asOf: Date | null;
  /// AI Overview の引用ドメインまで取得する対象か（§3.3.6・コストが伴うため画面で切替）
  aioTracked: boolean;
};

type RankRow = {
  keywordId: string;
  date: Date;
  position: number;
  clicks: number;
  impressions: number;
  ctr: number | null;
};

export async function getKeywordList(): Promise<{
  rows: KeywordRow[];
  latestDate: Date | null;
  /** 最新スナップショットで追跡外（＝順位が落ちて top-N から消えた）KW 数 */
  droppedOut: number;
}> {
  const [keywords, rankings] = await Promise.all([
    prisma.keyword.findMany({ select: { id: true, keyword: true, aioTracked: true } }),
    prisma.keywordRanking.findMany({
      select: {
        keywordId: true,
        date: true,
        position: true,
        clicks: true,
        impressions: true,
        ctr: true,
      },
      orderBy: { date: "desc" },
    }),
  ]);

  // 全体の最新／前回スナップショット日を求める
  const dates = [...new Set(rankings.map((r) => r.date.getTime()))].sort((a, b) => b - a);
  const latestMs = dates[0] ?? null;
  const prevMs = dates[1] ?? null;
  const latestDate = latestMs ? new Date(latestMs) : null;

  // keywordId → {latest(最新日の行), prev(前回日の行)}
  const latestByKw = new Map<string, RankRow>();
  const prevByKw = new Map<string, RankRow>();
  for (const r of rankings) {
    if (r.date.getTime() === latestMs) latestByKw.set(r.keywordId, r);
    else if (r.date.getTime() === prevMs) prevByKw.set(r.keywordId, r);
  }

  // ★最新スナップショットに存在するKWだけを「現在順位」として扱う（古い順位を混ぜない）
  const rows: KeywordRow[] = [];
  let droppedOut = 0;
  for (const k of keywords) {
    const latest = latestByKw.get(k.id);
    if (!latest) {
      droppedOut += 1; // 最新に居ない＝追跡外に落ちた
      continue;
    }
    const prev = prevByKw.get(k.id);
    const delta = prev ? Math.round((prev.position - latest.position) * 10) / 10 : null;
    rows.push({
      id: k.id,
      keyword: k.keyword,
      position: Math.round(latest.position * 10) / 10,
      positionDelta: delta,
      clicks: Math.round(latest.clicks),
      impressions: Math.round(latest.impressions),
      ctr: latest.ctr,
      band: bandOf(latest.position),
      asOf: latest.date,
      aioTracked: k.aioTracked,
    });
  }

  // 機会順: 表示が多い順（1ページ目未達の伸びしろが上に来やすい）
  rows.sort((a, b) => b.impressions - a.impressions);
  return { rows, latestDate, droppedOut };
}

export type KeywordStats = {
  total: number;
  top3: number;
  top10: number;
  striking: number;
  out: number;
  totalClicks: number;
  totalImpressions: number;
};

export function computeStats(rows: KeywordRow[]): KeywordStats {
  const s: KeywordStats = {
    total: rows.length,
    top3: 0,
    top10: 0,
    striking: 0,
    out: 0,
    totalClicks: 0,
    totalImpressions: 0,
  };
  for (const r of rows) {
    s.totalClicks += r.clicks;
    s.totalImpressions += r.impressions;
    if (r.band === "top3") s.top3++;
    else if (r.band === "top10") s.top10++;
    else if (r.band === "striking") s.striking++;
    else if (r.band === "out") s.out++;
  }
  return s;
}
