import {
  getThreadsData,
  getAccountHealth,
  MIN_POSTS_FOR_STAT,
  MIN_ENGAGEMENTS_FOR_RATE,
  type GroupStat,
  type AccountHealth,
} from "@/lib/threads";
import { getAgencyData } from "@/lib/agency";
import { getPostBriefs, type PostBriefs } from "@/lib/post-briefs";
import { AgencySection } from "./agency-section";
import { getQueueOverview } from "@/lib/threads-queue";
import { QueueSection } from "./queue-section";

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
  const [
    { summary, byFormat, byTarget, byCore, byAgencyAngle, top },
    agency,
    health,
    briefs,
    queue,
  ] = await Promise.all([
    getThreadsData(),
    getAgencyData(),
    getAccountHealth(),
    getPostBriefs(),
    // ★GAS への往復が入る。落ちても他が出るよう getQueueOverview 側で握る
    getQueueOverview(),
  ]);

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

      <BriefPanel briefs={briefs} />
      <HealthPanel health={health} />

      <Section
        title="フォーマット別"
        note={`集客コンテンツのみ（代理店募集${summary.agencyPosts}投稿は別枠）。平均は計測済 ${MIN_POSTS_FOR_STAT}件以上のグループだけ算出する。倍率は中央値 ${num(summary.medianFormatAvg)} views 比。★views・いいね率・返信数で順位が食い違う（質問型は views 1位・いいね率11位・返信 2位）。どれを「反応が良い」と呼ぶかで採るべきフォーマットが変わるので、目的に合う列を見ること。`}
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
      {/* ★配信が止まると他の指標も全部止まる。先に出す */}
      <QueueSection data={queue} />

      <AgencySection data={agency} />
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
        viewsPerFollower の急落は「投稿はできているのに配信が絞られている」サインで、
        内容を書き直しても直りません。判定には{" "}
        <strong>フォロワー数の履歴が最低{" "}
        {/* HEALTH_MIN_DAYS と同じ値 */}7日分</strong> 必要です。
      </p>
    </div>
  );
}

/**
 * 次に書く投稿の指示。
 * ★文章は生成しない。「どの型で・どのテーマを」だけ出して人が書く（YMYL領域のため）。
 */
function BriefPanel({ briefs }: { briefs: PostBriefs }) {
  const urgent = (briefs.gapDays ?? 0) >= 2;

  return (
    <div className="mb-5">
      <h2 className="mb-2 text-[14px] font-semibold">次に書く投稿</h2>

      {briefs.gapDays !== null && (
        <p
          className={`mb-2 rounded-md px-3 py-2 text-[12px] ${
            urgent
              ? "bg-[var(--bad)]/10 text-[var(--bad)]"
              : "bg-[var(--panel-2)] text-[var(--muted)]"
          }`}
        >
          最終投稿から <strong>{briefs.gapDays}日</strong>
          {briefs.postsPerDay !== null && (
            <>
              ・実績は1日あたり約 <strong>{briefs.postsPerDay}投稿</strong>
              {briefs.needed ? (
                <>
                  {" "}→ 空きを埋めるには <strong>約{briefs.needed}件</strong> の補充が必要
                </>
              ) : null}
            </>
          )}
        </p>
      )}

      {briefs.blocked ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4 text-[12px] text-[var(--muted)]">
          指示を出せません: {briefs.blocked}
        </div>
      ) : (
        <>
          <p className="mb-2 text-[12px] text-[var(--faint)]">
            ★文章は生成しません。効いている「型」と需要のある「テーマ」の組み合わせだけを出します。
            税務はYMYL領域で、実際に7件がYMYLチェックで停止しています。本文は人が書いてください。
          </p>
          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                    <th className="whitespace-nowrap px-3 py-2 font-medium">型</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">テーマ</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">根拠</th>
                  </tr>
                </thead>
                <tbody>
                  {briefs.briefs.map((b, i) => (
                    <tr
                      key={`${b.format}-${i}`}
                      className="border-b border-[var(--border)] last:border-0 align-top"
                    >
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <strong>{b.format}</strong>
                        <span className="ml-1 text-[11px] text-[#1a7a2e]">×{b.formatRatio}</span>
                      </td>
                      <td className="max-w-[300px] px-3 py-2.5">
                        {b.theme}
                        <span className="ml-1 rounded bg-[var(--panel-2)] px-1 py-0.5 text-[10px] text-[var(--faint)]">
                          {b.themeSourceLabel}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] leading-relaxed text-[var(--muted)]">
                        {b.rationale}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** 配信制限の兆候（§2454）。★履歴が足りないうちは「異常なし」と言わない */
function HealthPanel({ health }: { health: AccountHealth }) {
  const { latest, rows, hasBaseline, minDays, suspectedDays } = health;

  if (!latest) {
    return (
      <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
        <h2 className="text-[14px] font-semibold">アカウントの健全性</h2>
        <p className="mt-1 text-[12px] text-[var(--muted)]">
          フォロワー数の履歴がまだありません。GAS の <code>Account.gs</code> で
          日次記録を開始し、<code>Api.gs</code> を再デプロイすると取り込まれます。
          <br />
          ★<strong>これは「異常なし」ではなく「まだ測っていない」状態です。</strong>
          followers_count は過去に遡れないため、記録を始めた日からしか履歴が作れません。
        </p>
      </div>
    );
  }

  const measured = rows.filter((r) => r.viewsPerFollower !== null).length;

  return (
    <div className="mb-4">
      <h2 className="mb-2 text-[14px] font-semibold">アカウントの健全性</h2>
      {suspectedDays > 0 ? (
        <p className="mb-2 rounded-md bg-[var(--bad)]/10 px-3 py-2 text-[12px] text-[var(--bad)]">
          ★直近60日のうち <strong>{suspectedDays}日</strong> で viewsPerFollower の急落を検知
          しました。フォロワーは横ばいなのに到達だけ落ちている状態＝
          <strong>配信制限を疑うべき</strong>サインです。投稿内容の書き直しでは直りません。
        </p>
      ) : !hasBaseline ? (
        <p className="mb-2 rounded-md bg-[var(--warn)]/12 px-3 py-2 text-[12px] text-[#9a6a00]">
          判定に必要な履歴が足りません（計測済 {measured}日 / 必要 {minDays}日）。
          ★<strong>「異常なし」ではなく「まだ判定できない」</strong>状態です。
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat
          label="フォロワー"
          value={latest.followers.toLocaleString("ja-JP")}
          hint={`前日比 ${latest.followersDelta >= 0 ? "+" : ""}${latest.followersDelta}`}
        />
        <Stat
          label="平均views"
          value={latest.avgViews === null ? "—" : Math.round(latest.avgViews).toLocaleString("ja-JP")}
          hint="その日に公開した投稿の平均"
        />
        <Stat
          label="views/フォロワー"
          value={latest.viewsPerFollower === null ? "—" : latest.viewsPerFollower.toFixed(2)}
          hint="1フォロワーあたりの到達"
          accent
        />
        <Stat
          label="配信制限の疑い"
          value={!hasBaseline ? "判定不能" : suspectedDays > 0 ? `${suspectedDays}日` : "なし"}
          hint={hasBaseline ? `直近${rows.length}日で判定` : `履歴 ${measured}/${minDays}日`}
          bad={suspectedDays > 0}
        />
      </div>
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
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">いいね率</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">返信/投稿</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">いいね</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">返信</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">送客計</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">→LINE</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">→記事</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">→LP</th>
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
                    {/* ★いいね率と返信は views と順位が食い違う。並べて出す */}
                    <td className="tnum px-3 py-2 text-right font-medium">
                      {g.likeRate === null ? (
                        <span
                          className="text-[11px] text-[var(--faint)]"
                          title={`いいね計 ${g.totalLikes}件 < ${MIN_ENGAGEMENTS_FOR_RATE}件のため率を出さない（少ない=優秀ではない）`}
                        >
                          反応不足
                        </span>
                      ) : (
                        `${g.likeRate.toFixed(2)}%`
                      )}
                    </td>
                    <td className="tnum px-3 py-2 text-right font-medium">
                      {g.repliesPerPost === null ? "—" : g.repliesPerPost.toFixed(2)}
                    </td>
                    <td className="tnum px-3 py-2 text-right text-[var(--muted)]">
                      {g.totalLikes}
                    </td>
                    <td className="tnum px-3 py-2 text-right text-[var(--muted)]">
                      {g.totalReplies}
                    </td>
                    {/* ★送客は4つの目的のうち2つに直接対応する唯一の実測値。
                        リンクを貼っていないグループの 0 は「効かなかった」ではなく
                        「導線が無い」。区別して出す。
                        ★遷移先を分ける。LINE登録は follow イベントに経路が
                        入らないため、投稿別の貢献はこのクリック数でしか近似できない */}
                    <td className="tnum px-3 py-2 text-right font-medium">
                      {/* ★クリックが記録されているのに「導線なし」で隠さない。
                          シートに article_link が無いままリンクが踏まれている
                          （＝別経路で貼られている）ことに気づけなくなる */}
                      {g.linkedPosts === 0 && g.clicks === 0 ? (
                        <span className="text-[11px] text-[var(--faint)]" title="この群にリンク付き投稿が1本も無く、クリックも無い">
                          導線なし
                        </span>
                      ) : (
                        <>
                          {g.clicks.toLocaleString("ja-JP")}
                          <span className="ml-1 text-[11px] text-[var(--faint)]">
                            /{g.linkedPosts}本
                          </span>
                        </>
                      )}
                    </td>
                    {(["line", "soken", "lp"] as const).map((d) => (
                      <td key={d} className="tnum px-3 py-2 text-right text-[var(--muted)]">
                        {g.linkedPosts === 0 && g.clicks === 0 ? "—" : (g.clicksByDest[d] ?? 0)}
                      </td>
                    ))}
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
