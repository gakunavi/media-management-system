import Link from "next/link";
import { NOT_MEASURED } from "@mms/shared";
import { getKeywordList, computeStats } from "@/lib/keywords";
import {
  getQueryInsights,
  STRIKING_MIN,
  STRIKING_MAX,
  type QueryInsights,
  type QueryRow,
} from "@/lib/search-queries";
import { getKeywordCandidates } from "@/lib/keyword-candidates";
import { KeywordTable } from "./keyword-table";
import { Candidates } from "./candidates";

// キーワード（設計書 §4.2 /keywords・§13.3 striking distance・§3.3.3 順位分布）
export const dynamic = "force-dynamic";

const jaDate = (d: Date | null) =>
  d ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";

export default async function KeywordsPage() {
  const [{ rows, latestDate, droppedOut }, candidates, insights] = await Promise.all([
    getKeywordList(),
    getKeywordCandidates(),
    getQueryInsights(),
  ]);
  const s = computeStats(rows);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">キーワード</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            最新スナップショット {jaDate(latestDate)}・追跡 {s.total}件
            {droppedOut > 0 && (
              <span className="text-[var(--faint)]">
                （前回まで追跡・今回圏外 {droppedOut}件）
              </span>
            )}
          </p>
        </div>
      </div>

      {/* 順位分布（§3.3.3 トップページ食い込み率） */}
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <BandStat label="1-3位" value={s.top3} tone="ok" hint="CTRが跳ねる最上位" />
        <BandStat label="4-10位" value={s.top10} tone="accent" hint="1ページ目" />
        <BandStat
          label="11-20位"
          value={s.striking}
          tone="warn"
          hint="★striking distance"
        />
        <BandStat label="21位〜" value={s.out} tone="faint" hint="圏外に近い" />
      </div>

      {/* ★ここから下は「追跡KW」ではなく **記事が実際に来ている検索語**（GSC page×query）。
          追跡KW（ラッコの調査KW）は狙い、こちらは実測。両者は一致しない */}
      <ActualQueries insights={insights} />

      <Candidates candidates={candidates} />

      <KeywordTable rows={rows} />

      <p className="mt-3 text-[12px] text-[var(--faint)]">
        検索数・難易度・担当記事はラッコの調査済みKWのみ（§3-8）。「—」は未取得であって0ではない。
        順位の「未計測」は一度も順位が付いたことがないKW（追加直後）で、「圏外」とは別。
      </p>
    </div>
  );
}

/**
 * 記事が実際に来ている検索語から、打ち手が決まるものだけを出す。
 *
 * ★全1806行を並べても「どれを直すか」は決まらない。出すのは3つだけ:
 *   ① あと一押しで1ページ目（11〜20位）→ リライトの優先順位そのもの
 *   ② 1ページ目に居るのに押されない  → タイトル/説明文の打ち手
 *   ③ 同じ語で複数記事が競合          → 統合するか役割を分ける
 */
function ActualQueries({ insights }: { insights: QueryInsights }) {
  if (!insights.measured) {
    return (
      <section className="mb-4 rounded-xl border border-[var(--warn)]/40 bg-[var(--warn)]/[0.06] p-4">
        <h2 className="text-[14px] font-semibold">記事が実際に来ている検索語</h2>
        <p className="mt-1 text-[13px]">
          <span className="font-medium text-[var(--warn)]">{NOT_MEASURED}</span>
          <span className="ml-2 text-[12px] text-[var(--muted)]">
            <code>builtin/gsc_queries.py</code> を実行すると GSC の page×query が入る。
          </span>
        </p>
      </section>
    );
  }
  return (
    <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <h2 className="text-[14px] font-semibold">記事が実際に来ている検索語</h2>
      <p className="mb-3 mt-0.5 text-[12px] text-[var(--faint)]">
        {jaDate(insights.periodStart)}〜{jaDate(insights.periodEnd)}・
        {insights.totalQueries.toLocaleString("ja-JP")}語 / {insights.articlesWithQueries}記事。
        ★上の「追跡KW」は<strong>狙っているKW</strong>（ラッコの調査）、
        こちらは<strong>実際に来ているKW</strong>。両者はふつう一致しない。
      </p>

      <QueryBlock
        title={`あと一押しで1ページ目（${STRIKING_MIN}〜${STRIKING_MAX}位）`}
        note="★リライトの優先順位はここで決まる。表示が多い＝需要がある のに1ページ目に届いていない。"
        rows={insights.striking}
        empty="この帯に入っている検索語がない"
      />

      <QueryBlock
        title="1ページ目に居るのに押されていない"
        note={
          `★表示100回以上・10位以内のものだけ（母数が無いとCTRは偶然で跳ねる）。` +
          `多くはタイトル・説明文の問題だが、` +
          (insights.lowCtrNavigational > 0
            ? `このうち${insights.lowCtrNavigational}件は「国税庁 …」型の指名検索で、` +
              `利用者は公式ページを開きに来ている。**直してもクリックは増えない**（下に回してある）。`
            : `公的機関を名指しした検索語は直しても増えない。`)
        }
        rows={insights.lowCtr}
        empty="該当なし"
      />

      <div className="mt-4">
        <h3 className="text-[13px] font-medium">
          同じ検索語で複数記事が競合している（カニバリ）
        </h3>
        <p className="mb-1.5 mt-0.5 text-[12px] text-[var(--faint)]">
          ★互いに順位を食い合う。統合するか、狙う語を分ける。合計表示30回以上のものだけ。
        </p>
        {insights.cannibals.length === 0 ? (
          <p className="text-[13px] text-[var(--faint)]">該当なし</p>
        ) : (
          <div className="grid gap-2">
            {insights.cannibals.map((c) => (
              <div
                key={c.query}
                className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2"
              >
                <div className="flex items-baseline gap-2 text-[13px]">
                  <span className="font-medium">{c.query}</span>
                  <span className="tnum text-[12px] text-[var(--muted)]">
                    合計 {c.impressions.toLocaleString("ja-JP")} 表示・{c.items.length}記事
                  </span>
                </div>
                <ul className="mt-1 grid gap-0.5">
                  {c.items.map((it) => (
                    <li key={it.externalId} className="flex items-baseline gap-2 text-[12px]">
                      <Link
                        href={`/content/${it.externalId}`}
                        className="truncate text-[var(--muted)] hover:text-[var(--accent)] hover:underline"
                      >
                        {it.title}
                      </Link>
                      <span className="tnum ml-auto whitespace-nowrap text-[var(--faint)]">
                        {it.position === null ? "—" : `${it.position.toFixed(1)}位`}・
                        {it.clicks}クリック / {it.impressions}表示
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function QueryBlock({
  title,
  note,
  rows,
  empty,
}: {
  title: string;
  note: string;
  rows: QueryRow[];
  empty: string;
}) {
  return (
    <div className="mt-3">
      <h3 className="text-[13px] font-medium">{title}</h3>
      <p className="mb-1.5 mt-0.5 text-[12px] text-[var(--faint)]">{note}</p>
      {rows.length === 0 ? (
        <p className="text-[13px] text-[var(--faint)]">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[11px] text-[var(--muted)]">
                <th className="py-1 pr-2 font-medium">検索語</th>
                <th className="py-1 pr-2 font-medium">記事</th>
                <th className="py-1 pr-2 text-right font-medium">順位</th>
                <th className="py-1 pr-2 text-right font-medium">表示</th>
                <th className="py-1 pr-2 text-right font-medium">クリック</th>
                <th className="py-1 text-right font-medium">CTR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.query}${r.externalId}`} className="border-b border-[var(--border)]/60">
                  <td className="py-1.5 pr-2 font-medium">
                    {r.query}
                    {r.navigational && (
                      <span className="ml-1.5 rounded bg-[var(--panel-2)] px-1 py-0.5 text-[10px] font-normal text-[var(--faint)]">
                        指名検索
                      </span>
                    )}
                  </td>
                  <td className="max-w-[18rem] py-1.5 pr-2">
                    <Link
                      href={`/content/${r.externalId}`}
                      className="block truncate text-[12px] text-[var(--muted)] hover:text-[var(--accent)] hover:underline"
                      title={r.title}
                    >
                      {r.title}
                    </Link>
                  </td>
                  <td className="tnum py-1.5 pr-2 text-right">
                    {r.position === null ? "—" : r.position.toFixed(1)}
                  </td>
                  <td className="tnum py-1.5 pr-2 text-right text-[var(--muted)]">
                    {r.impressions.toLocaleString("ja-JP")}
                  </td>
                  <td className="tnum py-1.5 pr-2 text-right">{r.clicks}</td>
                  <td className="tnum py-1.5 text-right text-[var(--muted)]">
                    {r.ctr === null ? "—" : `${(r.ctr * 100).toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BandStat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: "ok" | "accent" | "warn" | "faint";
  hint: string;
}) {
  const color =
    tone === "ok"
      ? "text-[#1a7a2e]"
      : tone === "accent"
        ? "text-[var(--accent)]"
        : tone === "warn"
          ? "text-[#9a6a00]"
          : "text-[var(--faint)]";
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
      <div className="text-[12px] text-[var(--muted)]">{label}</div>
      <div className={`tnum mt-1 text-2xl font-bold leading-none ${color}`}>{value}</div>
      <div className="mt-1 text-[10px] text-[var(--faint)]">{hint}</div>
    </div>
  );
}
