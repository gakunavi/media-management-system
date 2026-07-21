// 追跡候補キーワード（設計書 §3-8 KWリサーチ）
//
// ★ラッコの既存エクスポートに、まだ追跡していないKWが検索数つきで埋もれていた。
//   suggests には 1,299件のユニークKWがあり、うち326件は検索数が判明している。
//   追加課金なしで使える発見の元。
//
// ★自動追加はしない。追跡対象を増やすと SERP取得（$0.0006/KW/週）が比例して
//   増える。どこまで追うかは費用対効果の判断なので、候補として出して人が選ぶ。
import { prisma } from "@mms/db";

/** SERP取得の単価（実測）。追加時のコストを画面に出すために使う */
export const SERP_USD_PER_KEYWORD_WEEK = 0.0006;

export type KeywordCandidate = {
  keyword: string;
  volume: number;
  difficulty: number | null;
  /** どの調査KWから出てきたか */
  from: string[];
};

type SuggestItem = {
  keyword?: unknown;
  volume?: unknown;
  search_volume?: unknown;
  difficulty?: unknown;
  seo_difficulty?: unknown;
};

function num(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/**
 * 追跡していない＝Keyword に無いKWのうち、検索数が判明しているものを返す。
 * @param minVolume これ未満は出さない（ノイズが多くなるため）
 */
export async function getKeywordCandidates(minVolume = 100): Promise<KeywordCandidate[]> {
  const [research, tracked] = await Promise.all([
    prisma.keywordResearch.findMany({
      select: { suggests: true, keyword: { select: { keyword: true } } },
    }),
    prisma.keyword.findMany({ select: { keyword: true } }),
  ]);

  const trackedSet = new Set(tracked.map((k) => k.keyword.trim().toLowerCase()));
  const byKeyword = new Map<string, KeywordCandidate>();

  for (const r of research) {
    const items = Array.isArray(r.suggests) ? (r.suggests as SuggestItem[]) : [];
    for (const it of items) {
      if (!it || typeof it !== "object") continue;
      const kw = typeof it.keyword === "string" ? it.keyword.trim() : "";
      if (!kw) continue;
      if (trackedSet.has(kw.toLowerCase())) continue; // 既に追跡中

      // ★エクスポート形式が2つある（volume / search_volume）。両方見る
      const volume = num(it.volume, it.search_volume);
      if (volume === null || volume < minVolume) continue;
      const difficulty = num(it.difficulty, it.seo_difficulty);

      const cur = byKeyword.get(kw);
      if (cur) {
        cur.volume = Math.max(cur.volume, volume);
        if (cur.difficulty === null && difficulty !== null) cur.difficulty = difficulty;
        if (!cur.from.includes(r.keyword.keyword)) cur.from.push(r.keyword.keyword);
      } else {
        byKeyword.set(kw, {
          keyword: kw,
          volume,
          difficulty,
          from: [r.keyword.keyword],
        });
      }
    }
  }

  return [...byKeyword.values()].sort((a, b) => b.volume - a.volume).slice(0, 60);
}
