// 次に書くべき Threads 投稿の指示（設計書 §4.2 /threads・§13.4-④）
//
// ★方針: 文章は生成しない。「どのフォーマットで・どのテーマを」だけを出す。
//   税務コンテンツは YMYL 領域で、実際に7件が GAS の YMYL チェックで
//   止まっている。機械が文章を量産すると、その全件を人がレビューし直す
//   ことになり、省ける手間より事故のリスクが上回る。
//   判断材料（何が効いているか・何に需要があるか）を出して人が書く方が、
//   同じデータからより安全に価値を取り出せる。
//
// ★材料はすべて既に集めたもの:
//   - フォーマット別の効き   … /threads（Threads Insights）
//   - テーマ                 … /ideas（AIO未引用・Threads反響）
//   - 空きの深刻さ           … 段7（最終投稿からの経過日数）
import { prisma } from "@mms/db";
import { getThreadsData, MIN_POSTS_FOR_STAT } from "./threads";
import { resolveRange } from "./period";
import { IDEA_SOURCE_LABEL } from "./ideas";

/** 指示を出すフォーマットの上限。多すぎると選べない */
const MAX_FORMATS = 3;
/** 1回に出す指示の件数 */
const MAX_BRIEFS = 9;

export type PostBrief = {
  format: string;
  formatAvgViews: number;
  formatRatio: number;
  theme: string;
  themeSource: string;
  themeSourceLabel: string;
  rationale: string;
};

export type PostBriefs = {
  briefs: PostBrief[];
  /** 最終投稿からの日数。null は投稿実績なし */
  gapDays: number | null;
  /** 実績ベースの1日あたり投稿数 */
  postsPerDay: number | null;
  /** 空きを埋めるのに必要な概算件数 */
  needed: number | null;
  /** 指示を出せない理由（材料不足）。空なら出せている */
  blocked: string | null;
};

/**
 * 型の効きを見る期間。
 * ★1か月では母数（計測済10件以上の型）が揃わない。指示の材料としては
 *   直近90日を使う。画面の期間切替とは別（画面は実績、ここは判断材料）。
 */
const BRIEF_RANGE = "d90";

export async function getPostBriefs(now: Date = new Date()): Promise<PostBriefs> {
  const { summary, byFormat } = await getThreadsData(resolveRange({ range: BRIEF_RANGE }, now));

  // ── 効いているフォーマット（★母数が足りないものは使わない）──
  const formats = byFormat.rows
    .filter((g) => !g.isOther && g.avgViews !== null && g.measured >= MIN_POSTS_FOR_STAT)
    .slice(0, MAX_FORMATS);

  // ── テーマ（未対応のネタ）──
  const ideas = await prisma.idea.findMany({
    where: { state: "new" },
    orderBy: { createdAt: "desc" },
    select: { title: true, source: true, body: true },
    take: 30,
  });

  // ── 空きの深刻さ ──
  let gapDays: number | null = null;
  let postsPerDay: number | null = null;
  if (summary.lastPostedAt && summary.firstPostedAt) {
    const day = 86400000;
    gapDays = Math.max(
      0,
      Math.floor((now.getTime() - summary.lastPostedAt.getTime()) / day),
    );
    const span = Math.max(
      1,
      Math.round((summary.lastPostedAt.getTime() - summary.firstPostedAt.getTime()) / day),
    );
    postsPerDay = Math.round((summary.posts / span) * 10) / 10;
  }
  const needed = gapDays !== null && postsPerDay !== null ? Math.round(gapDays * postsPerDay) : null;

  if (formats.length === 0) {
    return {
      briefs: [],
      gapDays,
      postsPerDay,
      needed,
      blocked: `フォーマット別の実績が足りません（計測済 ${MIN_POSTS_FOR_STAT}件以上のフォーマットが無い）。効いている型が分からない状態で指示は出せません`,
    };
  }
  if (ideas.length === 0) {
    return {
      briefs: [],
      gapDays,
      postsPerDay,
      needed,
      blocked:
        "未対応のネタがありません。/ideas で [ネタを収集] を実行するか、既存のネタを処理してください",
    };
  }

  // ── フォーマット × テーマ を総当たりではなく順に組む ──
  // ★同じフォーマットに偏らせない。効いている型でも連投すると飽きられる
  const briefs: PostBrief[] = [];
  for (let i = 0; i < Math.min(MAX_BRIEFS, ideas.length); i++) {
    const f = formats[i % formats.length];
    const idea = ideas[i];
    const ratio = summary.medianFormatAvg
      ? (f.avgViews as number) / summary.medianFormatAvg
      : 1;

    briefs.push({
      format: f.name,
      formatAvgViews: f.avgViews as number,
      formatRatio: Math.round(ratio * 10) / 10,
      theme: stripPrefix(idea.title),
      themeSource: idea.source,
      themeSourceLabel: IDEA_SOURCE_LABEL[idea.source] ?? idea.source,
      rationale:
        `「${f.name}」は平均 ${(f.avgViews as number).toLocaleString("ja-JP")} views` +
        `（${f.measured}投稿・中央値比 ×${Math.round(ratio * 10) / 10}）。` +
        `テーマの根拠: ${firstSentence(idea.body)}`,
    });
  }

  return { briefs, gapDays, postsPerDay, needed, blocked: null };
}

/** ネタのタイトルは "[AIO未引用]「KW」— …" の形。見出しの装飾を落とす */
function stripPrefix(title: string): string {
  return title.replace(/^\[[^\]]+\]\s*/, "").trim();
}

function firstSentence(body: string | null): string {
  if (!body) return "（根拠なし）";
  const s = body.split("。")[0];
  return s.length > 90 ? `${s.slice(0, 90)}…` : `${s}。`;
}
