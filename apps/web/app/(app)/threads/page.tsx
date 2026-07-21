import { getThreadsData, MIN_POSTS_FOR_STAT, type GroupStat } from "@/lib/threads";

// Threads 実績（設計書 §4.2 /threads・§13.4-④）
//
// ★代理店DMの状態遷移（P5.6）と viewsPerFollower 急落検知はまだ。
//   いま出せるのは「投稿実績とフォーマット別の効き」で、これは
//   threads_format_shift の承認判断に必要な材料。
export const dynamic = "force-dynamic";

const jaDate = (d: Date | null) =>
  d ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";
const num = (n: number | null) => (n === null ? "—" : n.toLocaleString("ja-JP"));

export default async function ThreadsPage() {
  const { summary, byFormat, byTarget, byCore, byAgencyAngle, top } = await getThreadsData();

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">Threads</h1>
        <p className="mt-0.5 text-[13px] text-[var(--muted)]">
          {jaDate(summary.firstPostedAt)} 〜 {jaDate(summary.lastPostedAt)}・{summary.posts}投稿
          {summary.unmeasured > 0 && (
            <span className="text-[var(--bad)]">（うち未計測 {summary.unmeasured}件）</span>
          )}
        </p>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="投稿数" value={num(summary.posts)} hint="GASのキューから同期" />
        <Stat label="総views" value={num(summary.totalViews)} hint="計測できた投稿の合計" accent />
        <Stat label="平均views" value={num(summary.avgViews)} hint="★未計測は除外して算出" />
        <Stat
          label="未計測"
          value={num(summary.unmeasured)}
          hint="Insights未回収。0ではない"
          bad={summary.unmeasured > 0}
        />
      </div>

      <Section
        title="フォーマット別"
        note={`集客コンテンツのみ（代理店募集${summary.agencyPosts}投稿は別枠）。平均は計測済 ${MIN_POSTS_FOR_STAT}件以上のグループだけ算出する。倍率は中央値 ${num(summary.medianFormatAvg)} views 比。`}
        rows={byFormat}
        median={summary.medianFormatAvg}
      />
      {byAgencyAngle.length > 0 && (
        <Section
          title="代理店募集トラック（angle別）"
          note={`★フォーマット別の比較には含めていない。代理店募集は対象が狭くviewsは伸びないのが当然で、評価軸はDM獲得であってviewsではない。ここでviewsの優劣を判断しないこと（${summary.agencyPosts}投稿）。`}
          rows={byAgencyAngle}
          median={null}
        />
      )}
      <Section title="ターゲット別" rows={byTarget} median={summary.medianFormatAvg} />
      <Section title="コアメッセージ別" rows={byCore} median={summary.medianFormatAvg} />

      <h2 className="mb-2 mt-6 text-[14px] font-semibold">views TOP15</h2>
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                <th className="whitespace-nowrap px-3 py-2 font-medium">ID</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">本文</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">フォーマット</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">views</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">反応</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">投稿日</th>
              </tr>
            </thead>
            <tbody>
              {top.map((p) => (
                <tr key={p.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--faint)]">
                    {p.externalId}
                  </td>
                  <td className="max-w-[360px] truncate px-3 py-2">{p.title}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-[var(--muted)]">{p.format}</td>
                  <td className="tnum px-3 py-2 text-right font-medium">{num(p.views)}</td>
                  <td className="tnum px-3 py-2 text-right text-[var(--muted)]">
                    {num(p.engagement)}
                  </td>
                  <td className="tnum whitespace-nowrap px-3 py-2 text-right text-[var(--faint)]">
                    {jaDate(p.publishedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-[12px] text-[var(--faint)]">
        跳ねた投稿は{" "}
        <a className="text-[var(--accent)] underline" href="/ideas">
          ネタ
        </a>{" "}
        へ自動起票されます（§13.4-④）。配分の見直し提案は{" "}
        <a className="text-[var(--accent)] underline" href="/experiments">
          施策・PDCA
        </a>{" "}
        に出ます。
        <br />
        ★代理店DMの状態遷移（P5.6）と viewsPerFollower 急落検知は未実装です。
      </p>
    </div>
  );
}

function Section({
  title,
  note,
  rows,
  median,
}: {
  title: string;
  note?: string;
  rows: GroupStat[];
  median: number | null;
}) {
  return (
    <div className="mb-5">
      <h2 className="mb-2 mt-5 text-[14px] font-semibold">{title}</h2>
      {note && <p className="mb-2 text-[12px] text-[var(--faint)]">{note}</p>}
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                <th className="whitespace-nowrap px-3 py-2 font-medium">
                  {title.replace("別", "")}
                </th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">投稿数</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">計測済</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">平均views</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">平均反応</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">総views</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((g) => {
                const ratio = g.avgViews !== null && median ? g.avgViews / median : null;
                return (
                  <tr key={g.name} className="border-b border-[var(--border)] last:border-0">
                    <td className="max-w-[220px] truncate px-3 py-2">{g.name}</td>
                    <td className="tnum px-3 py-2 text-right">{g.posts}</td>
                    <td className="tnum px-3 py-2 text-right text-[var(--muted)]">
                      {g.measured}
                      {g.measured < g.posts && (
                        <span className="text-[var(--bad)]"> /{g.posts - g.measured}未</span>
                      )}
                    </td>
                    <td className="tnum px-3 py-2 text-right font-medium">
                      {g.avgViews === null ? (
                        <span
                          className="text-[11px] text-[var(--faint)]"
                          title={`計測済 ${g.measured}件 < ${MIN_POSTS_FOR_STAT}件のため平均を出さない`}
                        >
                          母数不足
                        </span>
                      ) : (
                        <>
                          {g.avgViews.toLocaleString("ja-JP")}
                          {ratio && (
                            <span
                              className={`ml-1 text-[11px] ${
                                ratio >= 1.5
                                  ? "text-[#1a7a2e]"
                                  : ratio < 0.6
                                    ? "text-[var(--bad)]"
                                    : "text-[var(--faint)]"
                              }`}
                            >
                              ×{ratio.toFixed(1)}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td className="tnum px-3 py-2 text-right text-[var(--muted)]">
                      {g.avgEngagement === null ? "—" : g.avgEngagement}
                    </td>
                    <td className="tnum px-3 py-2 text-right text-[var(--muted)]">
                      {g.totalViews.toLocaleString("ja-JP")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
  bad,
}: {
  label: string;
  value: string;
  hint: string;
  accent?: boolean;
  bad?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
      <div className="text-[12px] text-[var(--muted)]">{label}</div>
      <div
        className={`tnum mt-1 text-2xl font-bold leading-none ${
          bad ? "text-[var(--bad)]" : accent ? "text-[var(--accent)]" : ""
        }`}
      >
        {value}
      </div>
      <div className="mt-1 text-[10px] text-[var(--faint)]">{hint}</div>
    </div>
  );
}
