// Threads の2つのゴール（メディア送客 ／ DM）
//
// ★1本の階段にしない（2026-07-23 石井さん）。狙いが違う投稿を同じ物差しで
//   測ると、DM狙いの投稿が「送客していない」と評価される。並列に出す。
//
// ★「未計測」を小さく書かない。いまメディア送客は計測が始まっておらず、
//   それがこの画面で最大の事実。表の右端に「導線なし」と出すだけでは伝わらない。
import Link from "next/link";
import { NOT_MEASURED } from "@mms/shared";
import { Stages } from "@/components/stages";
import { TrendChart } from "@/components/chart";
import type { ThreadsGoals } from "@/lib/channel-threads";

function Delta({ now, prev }: { now: number | null; prev: number | null }) {
  if (now === null || prev === null) {
    return <span className="text-[11px] text-[var(--faint)]">前期間比 —</span>;
  }
  const d = now - prev;
  const cls = d > 0 ? "text-[#1a7a2e]" : d < 0 ? "text-[var(--bad)]" : "text-[var(--faint)]";
  return (
    <span className={`tnum text-[11px] ${cls}`}>前期間比 {d > 0 ? `+${d}` : d === 0 ? "±0" : d}</span>
  );
}

export function GoalsPanel({ g }: { g: ThreadsGoals }) {
  return (
    <div className="grid gap-4">
      {/* ── 2つのゴール ── */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="text-[15px] font-semibold">ゴール（並列に2つ）</h2>
        <p className="mb-3 mt-0.5 text-[12px] text-[var(--faint)]">
          ★どちらも「問い合わせ」に向かうが、経路が別で打ち手も別。合算しない。
          投稿がどちらを狙ったかは<strong>貼ったリンク</strong>で判定している。
          <br />
          「率」は成果 ÷ そのゴールを狙った投稿の views。分母に他のゴールの
          views を混ぜていないので、投稿数が変わっても比べられる。
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {g.goals.map((c) => (
            <div
              key={c.key}
              className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-4"
            >
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-medium">{c.label}</span>
                <Delta now={c.value} prev={c.prev} />
              </div>
              <div className="mt-1.5 flex items-baseline gap-1.5">
                {c.value === null ? (
                  <span className="text-lg font-medium text-[var(--warn)]">{NOT_MEASURED}</span>
                ) : (
                  <>
                    <span className="tnum text-3xl font-bold leading-none">
                      {c.value.toLocaleString("ja-JP")}
                    </span>
                    <span className="text-[13px] text-[var(--faint)]">{c.unit}</span>
                  </>
                )}
              </div>

              {/* ★何投稿でどれだけ効いたか。投稿数が違う期間・ゴールは
                  実数だけでは比べられないので率も出す */}
              <dl className="mt-3 grid grid-cols-4 gap-2 border-t border-[var(--border)] pt-2 text-[11px]">
                <div>
                  <dt className="text-[var(--faint)]">投稿</dt>
                  <dd className="tnum font-medium">{c.posts}</dd>
                </div>
                <div>
                  <dt className="text-[var(--faint)]">views</dt>
                  <dd className="tnum font-medium">
                    {c.posts === 0 ? "—" : c.views.toLocaleString("ja-JP")}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--faint)]">率</dt>
                  <dd className="tnum font-medium">
                    {c.rate === null ? (
                      <span className="text-[var(--faint)]">—</span>
                    ) : (
                      `${c.rate.toFixed(2)}%`
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--faint)]">1投稿</dt>
                  <dd className="tnum font-medium">
                    {c.perPost === null ? (
                      <span className="text-[var(--faint)]">—</span>
                    ) : (
                      c.perPost.toFixed(2)
                    )}
                  </dd>
                </div>
              </dl>

              {/* ★内訳。同じ「DM」でも代理店希望と見込み客では打ち手が違う */}
              {c.breakdown && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {c.breakdown.map((b) => (
                    <Link
                      key={b.label}
                      href={b.href}
                      className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--panel)]"
                    >
                      {b.label} <strong className="tnum ml-0.5">{b.value}</strong>
                    </Link>
                  ))}
                </div>
              )}

              <div className="mt-2">
                <Link
                  href={c.detailHref}
                  className="text-[11px] text-[var(--accent)] hover:underline"
                >
                  この先を見る →
                </Link>
              </div>
              <p className="mt-1.5 text-[11px] leading-snug text-[var(--faint)]">{c.note}</p>
            </div>
          ))}
        </div>

      </section>

      {/* ── 狙いの内訳 ── */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="text-[15px] font-semibold">投稿はどのゴールを狙っているか</h2>
        <p className="mb-3 mt-0.5 text-[12px] text-[var(--faint)]">
          リンクの遷移先で判定（/r/soken → メディア・/r/lp → 診断LP・/r/line → LINE）。
          リンクが無い代理店募集は DM 狙いとして数える。
        </p>
        <div className="flex flex-wrap gap-2">
          {g.postsByGoal.map((p) => (
            <div
              key={p.goal}
              className={`rounded-md border px-3 py-2 text-[12px] ${
                p.goal === "unset" && p.posts > 0
                  ? "border-[var(--warn)]/40 bg-[var(--warn)]/[0.08] text-[#9a6a00]"
                  : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"
              }`}
            >
              {p.label} <strong className="tnum ml-1">{p.posts}</strong>
            </div>
          ))}
        </div>
        {g.notes.map((n, i) => (
          <p
            key={i}
            className="mt-2 rounded-md bg-[var(--panel-2)] px-3 py-2 text-[12px] leading-relaxed text-[var(--muted)]"
          >
            ★{n}
          </p>
        ))}
      </section>

      {/* ── ゴールごとの階段 ── */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="mb-2 text-[15px] font-semibold">① メディア送客の階段</h2>
        <Stages
          stages={g.mediaFlow.stages}
          transitions={g.mediaFlow.transitions}
          biggestDropIndex={g.mediaFlow.biggestDropIndex}
          comparableSegments={g.mediaFlow.comparableSegments}
        />
        <p className="mt-2 text-[12px] text-[var(--faint)]">
          ★この先（記事 → 問い合わせ）は記事側の階段。ここでは繋げない（同じ人を
          二度数えることになるため）。
          <Link href="/?tab=overview" className="ml-1 text-[var(--accent)] hover:underline">
            ダッシュボードの段2
          </Link>
          で見る。
        </p>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="mb-2 text-[15px] font-semibold">② DM の階段</h2>
        <Stages
          stages={g.dmFlow.stages}
          transitions={g.dmFlow.transitions}
          biggestDropIndex={g.dmFlow.biggestDropIndex}
          comparableSegments={g.dmFlow.comparableSegments}
        />
        <p className="mt-2 text-[12px] text-[var(--faint)]">
          選別の中身（アングル別・stage別）は{" "}
          <Link href="/agency" className="text-[var(--accent)] hover:underline">
            代理店
          </Link>{" "}
          にあります。
        </p>
      </section>

      {/* ── 推移 ── */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="mb-2 text-[15px] font-semibold">推移（{g.days}日）</h2>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-[var(--border)] p-3.5">
            <div className="mb-1 text-[12px] font-medium text-[var(--muted)]">DM（件/日）</div>
            <TrendChart
              series={[{ label: "DM", color: "var(--accent)", points: g.trends.dms }]}
              height={140}
            />
          </div>
          <div className="rounded-lg border border-[var(--border)] p-3.5">
            <div className="mb-1 text-[12px] font-medium text-[var(--muted)]">
              メディア送客クリック（件/日）
            </div>
            <TrendChart
              series={[{ label: "記事クリック", color: "#1a7a2e", points: g.trends.mediaClicks }]}
              height={140}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
