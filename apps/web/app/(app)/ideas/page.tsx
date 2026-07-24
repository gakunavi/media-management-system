import { getIdeas, groupIdeas, IDEA_SOURCE_LABEL } from "@/lib/ideas";
import { RunIdeas } from "./run-ideas";
import { TopicGroups } from "./topic-groups";

// ネタ（設計書 §4.2 /ideas・§13.4-④「チャネル間でネタが循環する」）
export const dynamic = "force-dynamic";


export default async function IdeasPage() {
  const all = await getIdeas();
  // ★未対応を上に。着手すべきものが埋もれないようにする
  const order: Record<string, number> = { new: 0, adopted: 1, dismissed: 2 };
  const ideas = [...all].sort(
    (a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9) || +b.createdAt - +a.createdAt,
  );
  const openCount = all.filter((i) => i.state === "new").length;
  // ★話題で束ねる。35件並べても「書く記事」は十数本しかない
  const groups = groupIdeas(ideas.filter((i) => i.state === "new"));
  const newTopics = groups.filter((g) => g.covered.length === 0);
  const addTo = groups.filter((g) => g.covered.length > 0);
  const bySource = new Map<string, number>();
  for (const i of all) if (i.state === "new") bySource.set(i.source, (bySource.get(i.source) ?? 0) + 1);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">ネタ</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            未対応 {openCount}件を<strong>{groups.length}の話題</strong>にまとめました
            （全{all.length}件）
            {bySource.size > 0 && (
              <span className="text-[var(--faint)]">
                （
                {[...bySource]
                  .map(([s, n]) => `${IDEA_SOURCE_LABEL[s] ?? s} ${n}`)
                  .join(" / ")}
                ）
              </span>
            )}
          </p>
        </div>
        <RunIdeas />
      </div>

      {/* ★「35件のネタがある」に見せない。実際に書けるのは新規{newTopics.length}話題だけ */}
      {groups.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
            <div className="text-[12px] text-[var(--muted)]">まだ記事が無い話題</div>
            <div className="tnum mt-1 text-2xl font-bold leading-none text-[var(--accent)]">
              {newTopics.length}
            </div>
            <div className="mt-1 text-[10px] text-[var(--faint)]">新規記事の候補</div>
          </div>
          <div className="rounded-lg border border-[var(--warn)]/40 bg-[var(--warn)]/[0.08] p-3.5">
            <div className="text-[12px] text-[var(--muted)]">既に記事がある話題</div>
            <div className="tnum mt-1 text-2xl font-bold leading-none text-[#9a6a00]">
              {addTo.length}
            </div>
            <div className="mt-1 text-[10px] text-[var(--faint)]">
              ★新規で書くと自社どうしが競合する。既存記事への加筆を先に
            </div>
          </div>
        </div>
      )}

      {ideas.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-8 text-center">
          <p className="text-[13px] text-[var(--muted)]">
            まだネタがありません。[ネタを収集] を押すと、Threadsで跳ねた投稿と
            AI Overview に引用されていないKWから自動起票します。
          </p>
        </div>
      ) : (
        <TopicGroups groups={groups} />
      )}

      <p className="mt-4 text-[12px] text-[var(--faint)]">
        稼働中の供給源は <strong>Threads反響</strong>（§13.4-④）・
        <strong>AIO未引用</strong>（§3.3.6）・<strong>PAA質問</strong>（§13.4-②）の3つ。
        PAAは「自社記事が1本も割り当たっていないKW」の質問だけを出す（記事があるKWは
        回答済みか判定できないため出さない）。GSCギャップ・News は未実装。
        <br />
        ★[記事化する] は「施策・PDCA」への起票までを行います。ラッコでのKW取得まで
        自動で繋ぐのは P4.5（ラッコ連携）の後です。
      </p>
    </div>
  );
}
