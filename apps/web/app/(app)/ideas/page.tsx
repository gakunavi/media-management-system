import { getIdeas, IDEA_SOURCE_LABEL } from "@/lib/ideas";
import { RunIdeas } from "./run-ideas";
import { IdeaCard } from "./idea-card";

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
  const bySource = new Map<string, number>();
  for (const i of all) if (i.state === "new") bySource.set(i.source, (bySource.get(i.source) ?? 0) + 1);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">ネタ</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            記事ネタの自動供給・未対応 {openCount}件 / 全{all.length}件
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

      {ideas.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-8 text-center">
          <p className="text-[13px] text-[var(--muted)]">
            まだネタがありません。[ネタを収集] を押すと、Threadsで跳ねた投稿と
            AI Overview に引用されていないKWから自動起票します。
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {ideas.map((i) => (
            <IdeaCard key={i.id} idea={i} />
          ))}
        </div>
      )}

      <p className="mt-4 text-[12px] text-[var(--faint)]">
        供給源のうち稼働しているのは <strong>Threads反響</strong>（§13.4-④）と
        <strong> AIO未引用</strong>（§3.3.6）の2つ。GSCギャップ・PAA・News は未実装
        （ラッコ連携=P4.5 / News=P6）。
        <br />
        ★[記事化する] は「施策・PDCA」への起票までを行います。ラッコでのKW取得まで
        自動で繋ぐのは P4.5（ラッコ連携）の後です。
      </p>
    </div>
  );
}
