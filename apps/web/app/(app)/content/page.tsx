import Link from "next/link";
import { NOT_MEASURED } from "@mms/shared";
import {
  getContentList,
  applyFilterSort,
  resolveFilter,
  resolveSort,
  isUntagged,
  CONTENT_FILTERS,
  CONTENT_SORTS,
  CONTENT_STATUS_LABEL,
  AUDIENCE_LABEL,
  FORMAT_LABEL,
  tagStats,
  type ContentRow,
  type ContentList,
  type TagStat,
} from "@/lib/content";
import {
  getLinkClicks,
  LINK_KIND_LABEL,
  type LinkClickSummary,
} from "@/lib/link-clicks";
import {
  getReviewQueue,
  FRESHNESS_LABEL,
  type ReviewQueue,
  type ReviewRow,
} from "@/lib/review-queue";
import { resolveRange } from "@/lib/period";
import { RangePicker } from "@/components/range-picker";

// 記事・投稿一覧（設計書 §4.2 /content）
//
// ★記事はメディア送客の起点で、目的は問い合わせを増やすこと。
//   PV・クリック・順位はその手前の数字。だから「問い合わせ」列を並べる。
//
// ★埋まっていない軸（買い手・ファネル・鮮度・KW・クラスタ）を画面に出す。
//   列が無いと、空であることすら見えない（実際 159件中0件だった）。
export const dynamic = "force-dynamic";

const num = (n: number | null) => (n === null ? "—" : n.toLocaleString("ja-JP"));
const jaDate = (d: Date | null) =>
  d
    ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" })
    : "—";

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp);
  const filter = resolveFilter(sp.filter);
  const sort = resolveSort(sp.sort);

  const data = await getContentList(range);
  const rows = applyFilterSort(data.rows, filter, sort);
  // ★タグ別の実績。分類の目的はここ（どのタグが結果を生むか）
  const stats = tagStats(data.rows);
  // ★記事内のどのリンクが踏まれたか。リダイレクタは記事を持たないのでここで補う
  const links = await getLinkClicks(range);
  // ★リライト督促。期限だけで出すと処理能力を超えて誰も見なくなる（二段構え）
  const review = await getReviewQueue();

  const href = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    p.set("range", range.key);
    const from = one(sp.from);
    const to = one(sp.to);
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    if (filter !== "all") p.set("filter", filter);
    if (sort !== "clicks") p.set("sort", sort);
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `/content?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">記事・投稿</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            {range.label}・全{data.rows.length}件（表示 {rows.length}件）
          </p>
        </div>
        <RangePicker
          range={range}
          basePath="/content"
          keep={{
            filter: filter === "all" ? undefined : filter,
            sort: sort === "clicks" ? undefined : sort,
          }}
        />
      </div>

      <ReviewPanel q={review} />

      <TagStatsPanel
        title="読者別（誰に向けた記事が効いているか）"
        note="★1記事あたりで見る。記事数が違うタグを実数で比べると、本数が多いタグが勝つだけ。"
        stats={stats.audience}
      />
      <TagStatsPanel
        title="記事の型別（どの型が効いているか）"
        note="★比較記事は買う直前の読者が来る。実測でも唯一の成約は「主力5商材の比較」から出ている。"
        stats={stats.format}
      />
      <LinkClickPanel links={links} />
      <OutboundPanel data={data} />
      <CoveragePanel data={data} />

      {/* ── 絞り込み・並べ替え ── */}
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1">
          {CONTENT_FILTERS.map((f) => (
            <Link
              key={f.key}
              href={href({ filter: f.key })}
              className={`rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
                filter === f.key
                  ? "border-[var(--accent)] bg-[var(--accent)] text-white"
                  : "border-[var(--border-strong)] text-[var(--muted)] hover:bg-[var(--panel-2)]"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-1 text-[12px] text-[var(--faint)]">
          並べ替え:
          {CONTENT_SORTS.map((s) => (
            <Link
              key={s.key}
              href={href({ sort: s.key })}
              className={`rounded px-1.5 py-0.5 ${
                sort === s.key
                  ? "bg-[var(--panel-2)] font-medium text-[var(--ink)]"
                  : "hover:text-[var(--ink)]"
              }`}
            >
              {s.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                <Th>記事ID</Th>
                <Th>タイトル</Th>
                <Th className="text-right">問い合わせ</Th>
                <Th className="text-right">クリック</Th>
                <Th className="text-right">表示</Th>
                <Th className="text-right">PV</Th>
                <Th className="text-right">順位</Th>
                <Th className="text-right">前期間差</Th>
                <Th>読者</Th>
                <Th>型</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-[13px] text-[var(--faint)]">
                    この条件に当てはまる記事がありません。
                  </td>
                </tr>
              ) : (
                rows.map((r) => <Row key={r.id} r={r} />)
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-[12px] text-[var(--faint)]">
        {/* ★実データから出す。以前は「GSCは 2026-07-10 で停止中」と直書きされており、
            実際は7/20まで取れているのに「止まっている」と読めていた */}
        実測の最終日: 検索（GSC）{jaDate(data.asOf.clicks)} ／ PV（GA4）{jaDate(data.asOf.pv)} ／
        累計PV {jaDate(data.asOf.pvLifetime)}。GSCは2〜3日遅れて入るのが正常。
        <br />
        「問い合わせ」は<strong>その記事が初回接点だったリード</strong>（`firstTouchContentId`）。
        <span className="text-[var(--warn)]"> 未接続</span> は記事レコードが無いが実測がある
        URL（§3.2.2）。
      </p>
    </div>
  );
}

/**
 * リライト督促。
 *
 * ★期限切れを全部並べない。処理能力は週2〜3本（cowork 実績）で、
 *   件数がそれを超えると誰も見なくなる。**期限切れ×CTR不全**を先に出す。
 * ★CTR不全＝「順位は取れているのにクリック0」。実運用で着手理由の最多。
 */
function ReviewPanel({ q }: { q: ReviewQueue }) {
  const total = q.priority.length + q.overdue.length;
  if (total === 0 && q.dueSoon.length === 0 && q.ctrOnly.length === 0) return null;
  return (
    <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-[14px] font-semibold">見直しが要る記事</h2>
        <span className="text-[12px] text-[var(--muted)]">
          期限切れ {total}・まもなく {q.dueSoon.length}
        </span>
        <span className="ml-auto text-[12px] text-[var(--faint)]">
          処理能力の目安 週{q.weeklyCapacity}本
        </span>
      </div>
      <p className="mb-2 mt-0.5 text-[12px] text-[var(--faint)]">
        ★<strong>期限だけで並べない</strong>。実運用の着手理由で最も多いのは
        「順位は取れているのにクリック0」なので、期限切れのうち
        <strong>それに当たるものを先に出す</strong>。
        {q.noBaseline > 0 && (
          <>
            {" "}
            <span className="text-[var(--warn)]">
              最終レビュー日が無く期限を出せない記事が{q.noBaseline}本
            </span>
            （未計測ではなく未入力）。
          </>
        )}
      </p>

      {q.priority.length > 0 && (
        <ReviewList
          title="① 先に直す（期限切れ ＋ 表示はあるのにクリック0）"
          note="★打ち手は記事ごとに違う。下の指示を見る。"
          rows={q.priority}
          tone="bad"
        />
      )}
      {q.ctrOnly.length > 0 && (
        <ReviewList
          title="② 期限前だが、表示はあるのにクリック0"
          note="★期限を待つ理由が無い。取り逃している表示が多い順。"
          rows={q.ctrOnly.slice(0, 10)}
          tone="warn"
        />
      )}
      {q.overdue.length > 0 && (
        <ReviewList
          title="③ 期限切れ（クリックは出ている）"
          note="★急がない。順位・クリックが動いていないかだけ確認する。"
          rows={q.overdue}
          tone="warn"
        />
      )}
      {q.dueSoon.length > 0 && (
        <ReviewList
          title="④ まもなく期限"
          note=""
          rows={q.dueSoon.slice(0, 8)}
          tone="faint"
        />
      )}
    </section>
  );
}

function ReviewList({
  title,
  note,
  rows,
  tone,
}: {
  title: string;
  note: string;
  rows: ReviewRow[];
  tone: "bad" | "warn" | "faint";
}) {
  const color =
    tone === "bad" ? "text-[var(--bad)]" : tone === "warn" ? "text-[#9a6a00]" : "text-[var(--faint)]";
  return (
    <div className="mt-3">
      <h3 className={`text-[13px] font-medium ${color}`}>{title}</h3>
      {note && <p className="mb-1 mt-0.5 text-[11px] text-[var(--faint)]">{note}</p>}
      <table className="w-full text-[13px]">
        <tbody>
          {rows.map((r) => (
            <tr key={r.externalId} className="border-b border-[var(--border)]/60">
              <td className="py-1.5 pr-2">
                <Link
                  href={`/content/${r.externalId}`}
                  className="block truncate hover:text-[var(--accent)] hover:underline"
                  title={r.title}
                >
                  {r.title}
                </Link>
                {r.ctrFail && (
                  <>
                    <span className="text-[11px] text-[var(--faint)]">
                      「{r.ctrFail.query}」{r.ctrFail.position.toFixed(1)}位・
                      {r.ctrFail.impressions.toLocaleString("ja-JP")}表示でクリック0
                    </span>
                    {/* ★打ち手を出し分ける（cowork 指摘・2026-07-23）。
                        同じ語で他の記事も出ているならカニバリで、
                        タイトルを直しても互いに食い合ったまま。原因が違う。 */}
                    {r.ctrFail.rivals.length > 0 ? (
                      <div className="mt-1 rounded bg-[var(--warn)]/[0.12] px-1.5 py-1 text-[11px] text-[#9a6a00]">
                        <strong>カニバリ解消</strong>（同じ語で他{r.ctrFail.rivals.length}
                        記事も表示: {r.ctrFail.rivals
                          .slice(0, 4)
                          .map((v) => `${v.externalId} ${v.position.toFixed(0)}位`)
                          .join(" / ")}
                        ）。<strong>タイトル修正では効かない。</strong>
                        本命を決めて狙うKWを分け、内部リンクを本命へ寄せる。
                      </div>
                    ) : (
                      <div className="mt-1 rounded bg-[var(--panel-2)] px-1.5 py-1 text-[11px] text-[var(--muted)]">
                        <strong>タイトル・説明文</strong>を読者の質問への即答型に書き換える。
                        キーワードを並べ足すのは実測で効いていない。
                      </div>
                    )}
                  </>
                )}
              </td>
              <td className="w-24 whitespace-nowrap py-1.5 pr-2 text-right text-[11px] text-[var(--muted)]">
                {r.freshnessTier ? (FRESHNESS_LABEL[r.freshnessTier] ?? r.freshnessTier) : "—"}
              </td>
              <td className="tnum w-20 whitespace-nowrap py-1.5 text-right text-[11px] text-[var(--faint)]">
                {r.daysOver === null
                  ? "—"
                  : r.daysOver >= 0
                    ? `${r.daysOver}日超過`
                    : `あと${-r.daysOver}日`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 記事内のどのリンクが踏まれたか。
 *
 * ★リダイレクタ（/r/）だけでは「どの記事から」が出せない（送り元は設置場所IDのみ）。
 *   計測タグが a[href] を記事単位で拾うので、そちらで記事別に出す。
 * ★0 を見たら、まず「計測が始まっているか」を見る。未計測の0は
 *   「誰も踏んでいない」ではなく「そもそも数えていない」（§3）。
 */
function LinkClickPanel({ links }: { links: LinkClickSummary }) {
  if (!links.measured) {
    return (
      <section className="mb-4 rounded-xl border border-[var(--warn)]/40 bg-[var(--warn)]/[0.06] p-4">
        <h2 className="text-[14px] font-semibold">記事内リンクのクリック</h2>
        <p className="mt-1 text-[13px]">
          <span className="font-medium text-[var(--warn)]">{NOT_MEASURED}</span>
          <span className="ml-2 text-[12px] text-[var(--muted)]">
            計測タグ（<code>mms-tag.js</code>）が記事内の <code>a[href]</code> を拾うようにしたが、
            まだ1件も受信していない。記事に <code>data-article</code> 付きでタグが入っていれば、
            次に誰かがリンクを踏んだ時点で自動的に計測が始まる。
          </span>
        </p>
      </section>
    );
  }
  const top = links.links.slice(0, 15);
  return (
    <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-[14px] font-semibold">記事内リンクのクリック</h2>
        <span className="tnum text-2xl font-bold text-[var(--accent)]">{links.total}</span>
        <span className="text-[12px] text-[var(--muted)]">クリック</span>
        <span className="ml-auto text-[12px] text-[var(--faint)]">
          計測開始 {jaDate(links.startedAt)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {links.byKind.map((k) => (
          <span
            key={k.kind}
            className={`rounded-md border px-2 py-1 text-[12px] ${
              k.kind === "redirect"
                ? "border-[var(--accent)]/40 bg-[var(--accent)]/[0.08] font-medium"
                : "border-[var(--border-strong)] text-[var(--muted)]"
            }`}
          >
            {k.label} <span className="tnum">{k.clicks}</span>
          </span>
        ))}
        <span className="text-[12px] text-[var(--faint)]">｜設置場所:</span>
        {links.byArea.map((a) => (
          <span key={a.area} className="text-[12px] text-[var(--muted)]">
            {a.label} <span className="tnum">{a.clicks}</span>
          </span>
        ))}
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="mb-1 text-[12px] font-medium text-[var(--muted)]">
            踏まれたリンク（上位{top.length}）
          </h3>
          <table className="w-full text-[13px]">
            <tbody>
              {top.map((l) => (
                <tr key={`${l.href}${l.area}`} className="border-b border-[var(--border)]/60">
                  <td className="py-1.5 pr-2">
                    <div className="truncate font-medium" title={l.text || l.href}>
                      {l.text || l.href}
                    </div>
                    <div className="truncate text-[11px] text-[var(--faint)]" title={l.href}>
                      {LINK_KIND_LABEL[l.kind] ?? l.kind}・{l.href}
                      {l.articles > 1 && `（${l.articles}記事）`}
                    </div>
                  </td>
                  <td className="tnum w-12 py-1.5 text-right font-medium">{l.clicks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div>
          <h3 className="mb-1 text-[12px] font-medium text-[var(--muted)]">
            記事別（送客の多い順）
          </h3>
          <table className="w-full text-[13px]">
            <tbody>
              {links.articles.slice(0, 15).map((a) => (
                <tr key={a.externalId} className="border-b border-[var(--border)]/60">
                  <td className="py-1.5 pr-2">
                    <Link
                      href={`/content/${a.externalId}`}
                      className="truncate hover:text-[var(--accent)] hover:underline"
                    >
                      {a.title}
                    </Link>
                  </td>
                  <td className="tnum w-14 py-1.5 text-right font-medium text-[var(--accent)]">
                    {a.outbound || "—"}
                  </td>
                  <td className="tnum w-12 py-1.5 text-right text-[var(--muted)]">{a.clicks}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-[var(--faint)]">
            左の数字＝送客リンク（<code>/r/</code>）、右＝全リンク
          </p>
        </div>
      </div>
    </section>
  );
}

/**
 * 記事からの送客。
 * ★記事別に出さない。リダイレクタの送り元は設置場所ID（media-article-bottom 等）で、
 *   どの記事から踏まれたかを持たない。記事別に 0 を並べると
 *   「その記事は誰も踏んでいない」という誤った像になる。
 */
function OutboundPanel({ data }: { data: ContentList }) {
  const total = data.outbound.reduce((s, o) => s + o.clicks, 0);
  return (
    <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <h2 className="text-[14px] font-semibold">記事からの送客（設置場所別）</h2>
      <p className="mb-2 mt-0.5 text-[12px] text-[var(--faint)]">
        ★<strong>この数字は記事別に分解できない</strong>。リダイレクタの送り元は設置場所ID
        （<code>media-article-bottom</code> 等）で、どの記事から踏まれたかを持たないため。
        記事別は上の「記事内リンクのクリック」で見る（計測タグ側で記事IDを持っている）。
        <br />
        ★ただし<strong>両者は一致しない</strong>。こちらはサーバー側の実測なので広告ブロックの
        影響を受けず、上は JavaScript が動いた分だけ。<strong>合計はこちらが正</strong>で、
        内訳を知りたいときに上を見る。両方を一致させるには
        <code>/r/line/&#123;設置場所&#125;-&#123;記事ID&#125;</code> のように
        記事IDをURLへ入れる必要がある（cowork 側の作業）。
      </p>
      {data.outbound.length === 0 ? (
        <p className="text-[13px]">
          <span className="font-medium text-[var(--warn)]">
            {data.outboundMeasured ? "0クリック（実測）" : NOT_MEASURED}
          </span>
          <span className="ml-2 text-[12px] text-[var(--faint)]">
            {data.outboundMeasured
              ? "記事末CTAは設置済み。この期間はまだ踏まれていない"
              : "記事からの送客リンクがまだ計装されていない"}
          </span>
        </p>
      ) : (
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="tnum text-2xl font-bold text-[var(--accent)]">{total}</span>
          <span className="text-[12px] text-[var(--muted)]">クリック</span>
          <div className="flex flex-wrap gap-2">
            {data.outbound.map((o) => (
              <span
                key={`${o.dest}-${o.placement}`}
                className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--muted)]"
              >
                {o.placement} → {o.dest} <strong className="tnum ml-0.5">{o.clicks}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * タグ付けの充足。
 * ★埋まっていないことを画面に出す。列が無いと空であることすら見えない。
 *   段3「買い手の質」が未計測なのは、ここが0だから。
 */
function CoveragePanel({ data }: { data: ContentList }) {
  const c = data.coverage;
  const items = [
    { label: "読者", n: c.audience, why: "法人向け／個人事業主向けの伸びを分けて見る" },
    { label: "記事の型", n: c.format, why: "どの型が送客・問い合わせに効くかを見る" },
    { label: "メインKW", n: c.mainKeyword, why: "カニバリ検出に要る" },
    { label: "クラスタ", n: c.cluster, why: "トピッククラスタの構造分析に要る" },
    { label: "鮮度", n: c.freshness, why: "リライト時期の判定に要る" },
    { label: "AIO Tier", n: c.aio, why: "AI検索での引用対策" },
  ];
  return (
    <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <h2 className="text-[14px] font-semibold">タグ付けの充足（{c.total}記事）</h2>
      <p className="mb-2 mt-0.5 text-[12px] text-[var(--faint)]">
        ★ここが埋まらないと出せない指標がある。
        <strong>0件のものは「該当なし」ではなく未入力</strong>。
      </p>
      <div className="flex flex-wrap gap-2">
        {items.map((it) => {
          const ratio = c.total > 0 ? it.n / c.total : 0;
          const bad = it.n === 0;
          return (
            <div
              key={it.label}
              title={it.why}
              className={`rounded-md border px-3 py-2 text-[12px] ${
                bad
                  ? "border-[var(--warn)]/40 bg-[var(--warn)]/[0.08] text-[#9a6a00]"
                  : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"
              }`}
            >
              {it.label}{" "}
              <strong className="tnum ml-0.5">
                {it.n}/{c.total}
              </strong>
              <span className="ml-1 text-[10px]">({Math.round(ratio * 100)}%)</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * タグ別の実績。
 * ★実数ではなく「1記事あたり」を主に見る。記事数が違うタグを実数で比べると
 *   本数が多いタグが必ず勝ち、「増やすべき型」を取り違える。
 */
function TagStatsPanel({
  title,
  note,
  stats,
}: {
  title: string;
  note: string;
  stats: TagStat[];
}) {
  const maxPer = Math.max(1, ...stats.map((s) => s.clicksPerArticle));
  return (
    <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <h2 className="text-[14px] font-semibold">{title}</h2>
      <p className="mb-2 mt-0.5 text-[12px] text-[var(--faint)]">{note}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-[11px] text-[var(--muted)]">
              <th className="py-1.5 pr-2 font-medium">タグ</th>
              <th className="py-1.5 pr-2 text-right font-medium">記事</th>
              <th className="py-1.5 pr-2 text-right font-medium">1記事あたり</th>
              <th className="py-1.5 pr-2 font-medium"></th>
              <th className="py-1.5 pr-2 text-right font-medium">クリック</th>
              <th className="py-1.5 pr-2 text-right font-medium">CTR</th>
              <th className="py-1.5 pr-2 text-right font-medium">平均順位</th>
              <th className="py-1.5 pr-2 text-right font-medium">PV</th>
              <th className="py-1.5 text-right font-medium">問い合わせ</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s) => (
              <tr
                key={s.key}
                className={`border-b border-[var(--border)]/60 ${
                  s.key === "none" ? "text-[var(--faint)]" : ""
                }`}
              >
                <td className="py-1.5 pr-2 font-medium">{s.label}</td>
                <td className="tnum py-1.5 pr-2 text-right text-[var(--muted)]">{s.articles}</td>
                <td className="tnum py-1.5 pr-2 text-right font-medium">
                  {s.clicksPerArticle.toFixed(1)}
                </td>
                <td className="py-1.5 pr-2" style={{ width: 90 }}>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)]"
                      style={{ width: `${(s.clicksPerArticle / maxPer) * 100}%` }}
                    />
                  </div>
                </td>
                <td className="tnum py-1.5 pr-2 text-right">{s.clicks.toLocaleString("ja-JP")}</td>
                <td className="tnum py-1.5 pr-2 text-right text-[var(--muted)]">
                  {s.ctr === null ? "—" : `${(s.ctr * 100).toFixed(1)}%`}
                </td>
                <td className="tnum py-1.5 pr-2 text-right text-[var(--muted)]">
                  {s.avgPosition === null ? "—" : s.avgPosition.toFixed(1)}
                </td>
                <td className="tnum py-1.5 pr-2 text-right text-[var(--muted)]">
                  {s.pv.toLocaleString("ja-JP")}
                </td>
                <td className="tnum py-1.5 text-right font-medium">
                  {s.leads > 0 ? <span className="text-[var(--accent)]">{s.leads}</span> : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PositionDelta({ delta }: { delta: number | null }) {
  if (delta === null) return <span className="text-[var(--faint)]">—</span>;
  if (delta === 0) return <span className="text-[var(--faint)]">±0</span>;
  const improved = delta > 0; // 順位が小さくなった＝改善
  return (
    <span className={improved ? "text-[#1a7a2e]" : "text-[var(--bad)]"}>
      {improved ? "▲" : "▼"}
      {Math.abs(delta).toFixed(1)}
    </span>
  );
}

function Row({ r }: { r: ContentRow }) {
  return (
    <tr className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--panel-2)]">
      <td className="whitespace-nowrap px-3 py-2.5">
        <Link
          href={`/content/${r.externalId}`}
          className="font-mono text-[12px] text-[var(--accent)] hover:underline"
        >
          {r.externalId}
        </Link>
        {r.isPillar && (
          <span className="ml-1 rounded bg-[var(--accent-weak)] px-1 py-0.5 text-[9px] text-[var(--accent)]">
            柱
          </span>
        )}
        {r.type === "article_unlinked" && (
          <span className="ml-1 rounded bg-[var(--warn)]/15 px-1 py-0.5 text-[9px] text-[#9a6a00]">
            未接続
          </span>
        )}
      </td>
      <td className="max-w-[300px] truncate px-3 py-2.5" title={r.title}>
        <Link href={`/content/${r.externalId}`} className="hover:underline">
          {r.title}
        </Link>
        {r.status !== "publish" && (
          <span className="ml-1 text-[10px] text-[var(--faint)]">
            （{CONTENT_STATUS_LABEL[r.status] ?? r.status}）
          </span>
        )}
      </td>
      {/* ★ゴール。ここが最初に目に入る位置にある */}
      <td className="tnum whitespace-nowrap px-3 py-2.5 text-right font-medium">
        {r.leads > 0 ? (
          <span className="text-[var(--accent)]">
            {r.leads}
            {r.won > 0 && <span className="ml-0.5 text-[10px] text-[#1a7a2e]">成約{r.won}</span>}
          </span>
        ) : (
          <span className="text-[var(--faint)]">—</span>
        )}
      </td>
      <td className="tnum whitespace-nowrap px-3 py-2.5 text-right">{num(r.clicks)}</td>
      <td className="tnum whitespace-nowrap px-3 py-2.5 text-right text-[var(--muted)]">
        {num(r.impressions)}
      </td>
      <td className="tnum whitespace-nowrap px-3 py-2.5 text-right text-[var(--muted)]">
        {num(r.pv)}
      </td>
      <td className="tnum whitespace-nowrap px-3 py-2.5 text-right">
        {r.avgPosition === null ? "—" : r.avgPosition.toFixed(1)}
      </td>
      <td className="tnum whitespace-nowrap px-3 py-2.5 text-right">
        <PositionDelta delta={r.positionDelta} />
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-[12px]">
        {r.audience.length === 0 ? (
          <span className="text-[var(--warn)]">—</span>
        ) : (
          r.audience.map((a) => AUDIENCE_LABEL[a] ?? a).join("・")
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-[12px]">
        {r.contentFormat === null ? (
          <span className="text-[var(--warn)]">—</span>
        ) : (
          (FORMAT_LABEL[r.contentFormat] ?? r.contentFormat)
        )}
      </td>
    </tr>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`whitespace-nowrap px-3 py-2 font-medium ${className}`}>{children}</th>;
}
