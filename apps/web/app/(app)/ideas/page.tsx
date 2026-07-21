import { getIdeas, IDEA_SOURCE_LABEL } from "@/lib/ideas";
import { RunIdeas } from "./run-ideas";

// ネタ（設計書 §4.2 /ideas・§13.4-④「チャネル間でネタが循環する」）
export const dynamic = "force-dynamic";

const SOURCE_STYLE: Record<string, string> = {
  threads_hit: "bg-[var(--accent-weak)] text-[var(--accent)]",
  aio_miss: "bg-[var(--warn)]/15 text-[#9a6a00]",
};

export default async function IdeasPage() {
  const ideas = await getIdeas();
  const bySource = new Map<string, number>();
  for (const i of ideas) bySource.set(i.source, (bySource.get(i.source) ?? 0) + 1);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">ネタ</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            記事ネタの自動供給・{ideas.length}件
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
            <article
              key={i.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4"
            >
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                    SOURCE_STYLE[i.source] ?? "bg-[var(--panel-2)] text-[var(--faint)]"
                  }`}
                >
                  {IDEA_SOURCE_LABEL[i.source] ?? i.source}
                </span>
                {i.impacts.map((m) => (
                  <span
                    key={m}
                    className="rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]"
                  >
                    {m}
                  </span>
                ))}
                <span className="ml-auto text-[11px] text-[var(--faint)]">
                  {i.createdAt.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}
                </span>
              </div>
              <h2 className="text-[14px] font-semibold">{i.title}</h2>
              {i.body && (
                <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">{i.body}</p>
              )}
            </article>
          ))}
        </div>
      )}

      <p className="mt-4 text-[12px] text-[var(--faint)]">
        供給源のうち稼働しているのは <strong>Threads反響</strong>（§13.4-④）と
        <strong> AIO未引用</strong>（§3.3.6）の2つ。GSCギャップ・PAA・News は未実装
        （ラッコ連携=P4.5 / News=P6）。
        <br />
        ★[記事化する] からラッコ取得ジョブまで繋ぐのは P4.6 の残作業です。
      </p>
    </div>
  );
}
