import Link from "next/link";
import {
  getThreadsData,
  getAccountHealth,
  MIN_POSTS_FOR_STAT,
  MIN_ENGAGEMENTS_FOR_RATE,
  type GroupTable,
  type AccountHealth,
} from "@/lib/threads";
import { getThreadsGoals } from "@/lib/channel-threads";
import { getPostBriefs, type PostBriefs } from "@/lib/post-briefs";
import { getQueueOverview } from "@/lib/threads-queue";
import { resolveRange, type Range } from "@/lib/period";
import { RangePicker } from "@/components/range-picker";
import { QueueSection } from "./queue-section";
import { GoalsPanel } from "./goals-panel";

// Threads（設計書 §4.2 /threads・§13.4-④）
//
// ★Threads のゴールは **メディア送客 と DM の2つ**（2026-07-23 石井さん）。
//   並列のゴールであって、1本の階段ではない。だから画面もその順で作る:
//     タブ1「ゴール」   … 何件取れたか（＝判断する場所）
//     タブ2「投稿の効き」… なぜそうなったか（型・ターゲット・コアメッセージ）
//     タブ3「配信」     … 止まっていないか・次に何を書くか
//
// ★views は成果ではない。views の表を先頭に置くと、
//   「よく見られた」で満足して、ゴールに繋がっているかを見なくなる。
export const dynamic = "force-dynamic";

const TABS = [
  { key: "goals", label: "ゴール" },
  { key: "posts", label: "投稿の効き" },
  { key: "delivery", label: "配信" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const jaDate = (d: Date | null) =>
  d ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";
const num = (n: number | null) => (n === null ? "—" : n.toLocaleString("ja-JP"));

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ThreadsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp);
  const tabParam = one(sp.tab);
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "goals";

  const { summary } = await getThreadsData(range);

  const tabHref = (key: string) => {
    const p = new URLSearchParams();
    p.set("range", range.key);
    const from = one(sp.from);
    const to = one(sp.to);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    p.set("tab", key);
    return `/threads?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Threads</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            ゴールは①メディア送客と②DM。{range.label}・{summary.posts}投稿
            {summary.unmeasured > 0 && (
              <span className="text-[var(--bad)]">（うち未計測 {summary.unmeasured}件）</span>
            )}
          </p>
        </div>
        <RangePicker range={range} basePath="/threads" keep={{ tab }} />
      </div>

      <div className="mb-4 flex gap-1 border-b border-[var(--border)]">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
              tab === t.key
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "goals" && <GoalsTab range={range} />}
      {tab === "posts" && <PostsTab range={range} />}
      {tab === "delivery" && <DeliveryTab range={range} />}
    </div>
  );
}

/* ─────────────────────── タブ1: ゴール ─────────────────────── */

async function GoalsTab({ range }: { range: Range }) {
  const goals = await getThreadsGoals(range);
  return <GoalsPanel g={goals} />;
}

/* ─────────────────────── タブ2: 投稿の効き ─────────────────── */

async function PostsTab({ range }: { range: Range }) {
  const { summary, byFormat, byTarget, byCore, byAgencyAngle, top } = await getThreadsData(range);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-4">
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

      <p className="rounded-md bg-[var(--panel-2)] px-3 py-2 text-[12px] leading-relaxed text-[var(--muted)]">
        ★ここの数字は<strong>ゴールではなく、その手前</strong>。views が多い型が
        必ずしもDMや送客に効くとは限らない。返信は「会話が始まった」度合いで、
        DMに最も近い先行指標。
        <br />
        ★代理店募集トラック（{summary.agencyPosts}投稿）は全ての表から除外している。
        評価軸がDM獲得で、views で比べると「低調だから減らせ」という誤った結論になる。
      </p>

      <Section
        title="フォーマット別"
        note={`平均は計測済 ${MIN_POSTS_FOR_STAT}件以上のグループだけ算出する。倍率はこの表の中央値 ${num(byFormat.median)} views 比。`}
        table={byFormat}
      />
      <Section title="ターゲット別" table={byTarget} />
      <Section title="コアメッセージ別" table={byCore} />

      {byAgencyAngle.rows.length > 0 && (
        <div>
          <h2 className="mb-1 text-[14px] font-semibold">代理店募集トラック（参考）</h2>
          <p className="mb-2 text-[12px] text-[var(--faint)]">
            ★このトラックの評価軸は<strong>DM獲得</strong>であって views ではない。
            アングル別のDM実績は{" "}
            <Link href="/agency" className="text-[var(--accent)] hover:underline">
              代理店
            </Link>{" "}
            にあります。ここは配信量の確認用。
          </p>
          <Section title="アングル別" table={byAgencyAngle} />
        </div>
      )}

      <div>
        <h2 className="mb-2 text-[14px] font-semibold">views TOP15</h2>
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                  <th className="whitespace-nowrap px-3 py-2 font-medium">ID</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">本文</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">フォーマット</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">views</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">返信</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">送客</th>
                  <th className="whitespace-nowrap px-3 py-2 text-right font-medium">投稿日</th>
                </tr>
              </thead>
              <tbody>
                {top.map((p) => (
                  <tr key={p.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--faint)]">
                      {p.externalId}
                    </td>
                    <td className="max-w-[340px] truncate px-3 py-2">{p.title}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--muted)]">{p.format}</td>
                    <td className="tnum px-3 py-2 text-right font-medium">{num(p.views)}</td>
                    <td className="tnum px-3 py-2 text-right text-[var(--muted)]">
                      {num(p.replies)}
                    </td>
                    {/* ★リンクを貼っていない投稿の 0 は「効かなかった」ではない */}
                    <td className="tnum px-3 py-2 text-right text-[var(--muted)]">
                      {p.linkUrl === null ? (
                        <span className="text-[11px] text-[var(--faint)]">導線なし</span>
                      ) : (
                        p.clicks
                      )}
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
        <p className="mt-2 text-[12px] text-[var(--faint)]">
          跳ねた投稿は{" "}
          <Link href="/ideas" className="text-[var(--accent)] hover:underline">
            ネタ
          </Link>{" "}
          へ自動起票されます（§13.4-④）。配分の見直し提案は{" "}
          <Link href="/experiments" className="text-[var(--accent)] hover:underline">
            施策・PDCA
          </Link>{" "}
          に出ます。
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────── タブ3: 配信 ─────────────────────── */

async function DeliveryTab({ range }: { range: Range }) {
  const [health, briefs, queue] = await Promise.all([
    getAccountHealth(),
    getPostBriefs(),
    // ★GAS への往復が入る。落ちても他が出るよう getQueueOverview 側で握る
    getQueueOverview(),
  ]);

  return (
    <div className="grid gap-4">
      <QueueSection data={queue} />
      <BriefPanel briefs={briefs} />
      <HealthPanel health={health} />
      <p className="text-[12px] text-[var(--faint)]">
        期間の指定（{range.label}）は「ゴール」「投稿の効き」に効きます。配信の状態は
        いまの状態なので期間に依存しません。
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
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <h2 className="mb-2 text-[15px] font-semibold">次に書く投稿</h2>

      {briefs.gapDays !== null && (
        <p
          className={`mb-2 rounded-md px-3 py-2 text-[12px] ${
            urgent ? "bg-[var(--bad)]/10 text-[var(--bad)]" : "bg-[var(--panel-2)] text-[var(--muted)]"
          }`}
        >
          最終投稿から <strong>{briefs.gapDays}日</strong>
          {briefs.postsPerDay !== null && (
            <>
              ・実績は1日あたり約 <strong>{briefs.postsPerDay}投稿</strong>
              {briefs.needed ? (
                <>
                  {" "}
                  → 空きを埋めるには <strong>約{briefs.needed}件</strong> の補充が必要
                </>
              ) : null}
            </>
          )}
        </p>
      )}

      {briefs.blocked ? (
        <div className="rounded-lg border border-[var(--border)] p-4 text-[12px] text-[var(--muted)]">
          指示を出せません: {briefs.blocked}
        </div>
      ) : (
        <>
          <p className="mb-2 text-[12px] text-[var(--faint)]">
            ★文章は生成しません。効いている「型」と需要のある「テーマ」の組み合わせだけを出します。
            税務はYMYL領域で、実際に7件がYMYLチェックで停止しています。本文は人が書いてください。
            型の効きは<strong>直近90日</strong>の実績で選んでいます（1か月では母数が足りないため）。
          </p>
          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
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
                      className="border-b border-[var(--border)] align-top last:border-0"
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
    </section>
  );
}

/** 配信制限の兆候（§2454）。★履歴が足りないうちは「異常なし」と言わない */
function HealthPanel({ health }: { health: AccountHealth }) {
  const { latest, rows, hasBaseline, minDays, suspectedDays, historyDays } = health;

  if (!latest) {
    return (
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="text-[15px] font-semibold">アカウントの健全性</h2>
        <p className="mt-1 text-[12px] text-[var(--muted)]">
          フォロワー数の履歴がまだありません。GAS の <code>Account.gs</code> で 日次記録を開始し、
          <code>Api.gs</code> を再デプロイすると取り込まれます。
          <br />★<strong>これは「異常なし」ではなく「まだ測っていない」状態です。</strong>
          followers_count は過去に遡れないため、記録を始めた日からしか履歴が作れません。
        </p>
      </section>
    );
  }

  const measured = rows.filter((r) => r.viewsPerFollower !== null).length;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <h2 className="mb-2 text-[15px] font-semibold">アカウントの健全性</h2>
      {suspectedDays > 0 ? (
        <p className="mb-2 rounded-md bg-[var(--bad)]/10 px-3 py-2 text-[12px] text-[var(--bad)]">
          ★直近60日のうち <strong>{suspectedDays}日</strong> で viewsPerFollower の急落を検知
          しました。フォロワーは横ばいなのに到達だけ落ちている状態＝
          <strong>配信制限を疑うべき</strong>サインです。投稿内容の書き直しでは直りません。
        </p>
      ) : !hasBaseline ? (
        <p className="mb-2 rounded-md bg-[var(--warn)]/12 px-3 py-2 text-[12px] text-[#9a6a00]">
          判定できません。日次記録は <strong>{historyDays}日</strong>ぶん（必要 {minDays}日）、
          そのうち平均viewsを算出できたのは <strong>{measured}日</strong>です
          {measured < historyDays && "（その日の投稿の Insights がまだ回収されていないため）"}。
          ★<strong>「異常なし」ではなく「まだ判定できない」</strong>状態です。
          日次記録が毎日続けば、最短で残り {Math.max(0, minDays - historyDays)}日で判定できます。
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
          value={
            latest.avgViews === null ? "—" : Math.round(latest.avgViews).toLocaleString("ja-JP")
          }
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
      <p className="mt-2 text-[12px] text-[var(--faint)]">
        viewsPerFollower の急落は「投稿はできているのに配信が絞られている」サインで、
        内容を書き直しても直りません。平均views は GAS が入れていなければ MMS が
        （その日に公開した投稿の views から）自前で算出します。
      </p>
    </section>
  );
}

/* ─────────────────────── 共通 ─────────────────────── */

function Section({ title, note, table }: { title: string; note?: string; table: GroupTable }) {
  return (
    <div>
      <h2 className="mb-1 text-[14px] font-semibold">{title}</h2>
      {note && <p className="mb-2 text-[12px] text-[var(--faint)]">{note}</p>}
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                <th className="whitespace-nowrap px-3 py-2 font-medium">{title.replace("別", "")}</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">投稿数</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">計測済</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">返信/投稿</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">平均views</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">いいね率</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">いいね</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">返信</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">送客計</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">→記事</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">→LP</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">→LINE</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">総views</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((g) => {
                const ratio = g.avgViews !== null && table.median ? g.avgViews / table.median : null;
                return (
                  <tr
                    key={g.name}
                    className={`border-b border-[var(--border)] last:border-0 ${
                      g.isOther ? "bg-[var(--panel-2)] text-[var(--muted)]" : ""
                    }`}
                  >
                    <td className="max-w-[220px] truncate px-3 py-2" title={g.name}>
                      {g.name}
                    </td>
                    <td className="tnum px-3 py-2 text-right">{g.posts}</td>
                    <td className="tnum px-3 py-2 text-right text-[var(--muted)]">
                      {g.measured}
                      {g.measured < g.posts && (
                        <span className="text-[var(--bad)]"> /{g.posts - g.measured}未</span>
                      )}
                    </td>
                    {/* ★返信は「会話が始まった」度合い。DMに最も近い先行指標なので前に置く */}
                    <td className="tnum px-3 py-2 text-right font-medium">
                      {g.repliesPerPost === null ? (
                        <span className="text-[11px] text-[var(--faint)]">—</span>
                      ) : (
                        g.repliesPerPost.toFixed(2)
                      )}
                    </td>
                    <td className="tnum px-3 py-2 text-right">
                      {g.avgViews === null ? (
                        <span
                          className="text-[11px] text-[var(--faint)]"
                          title={
                            g.isOther
                              ? "型が混ざるため平均は出さない"
                              : `計測済 ${g.measured}件 < ${MIN_POSTS_FOR_STAT}件のため平均を出さない`
                          }
                        >
                          {g.isOther ? "混在" : "母数不足"}
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
                    <td className="tnum px-3 py-2 text-right">
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
                    <td className="tnum px-3 py-2 text-right text-[var(--muted)]">{g.totalLikes}</td>
                    <td className="tnum px-3 py-2 text-right text-[var(--muted)]">
                      {g.totalReplies}
                    </td>
                    {/* ★リンクを貼っていないグループの 0 は「効かなかった」ではなく導線が無い */}
                    <td className="tnum px-3 py-2 text-right font-medium">
                      {g.linkedPosts === 0 && g.clicks === 0 ? (
                        <span
                          className="text-[11px] text-[var(--faint)]"
                          title="この群にリンク付き投稿が1本も無く、クリックも無い"
                        >
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
                    {(["soken", "lp", "line"] as const).map((d) => (
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
