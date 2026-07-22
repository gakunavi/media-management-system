import { NOT_MEASURED } from "@mms/shared";
import { getLineChannel, type Entrance } from "@/lib/channel-line";
import { getReceiverStats } from "@/lib/receivers";
import { TrendChart } from "@/components/chart";
import { Stages } from "@/components/stages";
import { RangePicker } from "@/components/range-picker";
import { ReceiverScreen } from "@/components/receiver-screen";
import { resolveRange } from "@/lib/period";
import { LeadForm } from "../leads/lead-form";

// 公式LINE（設計書 §4.1 段1③）
//
// ★/leads は「どの経路が何件取れたか」の総合。ここは経路の中身で、
//   どの段で落ちているかを見る画面。落ちている段が分かれば打ち手が決まる。
export const dynamic = "force-dynamic";

export default async function LinePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const range = resolveRange(await searchParams);
  const [ch, stats] = await Promise.all([
    getLineChannel(range),
    // ★他の受け皿画面（/hp・/phone）と同じ軸を出す。
    //   LINEの問い合わせは Webhook では取れない（follow は取れるが相談は取れない）。
    //   実際そのすべてが手入力なので、この画面から登録できる必要がある
    getReceiverStats(["line"], "lead_line", range),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">公式LINE</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            {range.label}・送客 → 登録 → 反応 → 問い合わせ → 成約
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RangePicker range={range} basePath="/line" />
          <LeadForm defaultSourceType="line" label="＋ 記録する" />
        </div>
      </div>

      {ch.notMeasured.length > 0 && (
        <p className="mb-4 rounded-md bg-[var(--warn)]/12 px-3 py-2 text-[12px] text-[#9a6a00]">
          ★未計測の段があります: {ch.notMeasured.join(" / ")}。
          これらの 0 は「成果ゼロ」ではありません。
        </p>
      )}

      {/* ── 友だち総数 ── */}
      <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="flex flex-wrap items-center gap-6">
          <div>
            <div className="text-[12px] text-[var(--muted)]">友だち総数</div>
            <div className="tnum mt-0.5 text-2xl font-bold leading-none">
              {ch.friends.total === null ? (
                <span className="text-base font-medium text-[var(--warn)]">{NOT_MEASURED}</span>
              ) : (
                ch.friends.total.toLocaleString("ja-JP")
              )}
            </div>
          </div>
          {/* ★webhook で取れるのは設置以降の増減だけ。総数と混ぜない */}
          <div>
            <div className="text-[12px] text-[var(--muted)]">追加（期間内・観測分）</div>
            <div className="tnum mt-0.5 text-2xl font-bold leading-none">{ch.friends.added}</div>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--faint)]">{ch.friends.note}</p>
      </section>

      {/* ── 入口 ── */}
      <h2 className="mb-1 text-[14px] font-semibold">入口（どこから送っているか）</h2>
      <p className="mb-2 text-[12px] text-[var(--faint)]">
        ★「未計装」は<strong>送っていない</strong>のではなく<strong>測っていない</strong>。
        HP・記事の lin.ee は生リンクのままで、踏まれても記録されない。
      </p>
      <div className="mb-5 grid gap-2 sm:grid-cols-4">
        {ch.entrances.map((e) => (
          <EntranceCard key={e.key} e={e} />
        ))}
      </div>

      {/* ── 階段 ── */}
      <h2 className="mb-2 text-[14px] font-semibold">どこで落ちているか</h2>
      <Stages
        stages={ch.stages}
        transitions={ch.transitions}
        biggestDropIndex={ch.biggestDropIndex}
        comparableSegments={ch.comparableSegments}
      />

      {ch.stages[4].value !== null && ch.stages[4].value > 0 && (
        <div className="mb-5 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
          <div className="text-[12px] text-[var(--muted)]">成約金額</div>
          <div className="tnum mt-1 text-2xl font-bold leading-none text-[var(--accent)]">
            ¥{ch.wonAmount.toLocaleString("ja-JP")}
          </div>
        </div>
      )}

      {/* ── 推移 ── */}
      <h2 className="mb-2 mt-6 text-[14px] font-semibold">推移</h2>
      <div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3.5">
        {/* ★桁が違うので送客だけ別軸。未計測は線を切る（0で繋がない） */}
        <TrendChart
          series={[
            { label: "① 送客（クリック）", color: "#8aa0b8", points: ch.trends.sent },
            { label: "② 登録", color: "var(--accent)", points: ch.trends.followed, axis: "right" },
            { label: "④ 問い合わせ", color: "#1a7a2e", points: ch.trends.inquired, axis: "right" },
          ]}
        />
      </div>

      {/* ── 種別・きっかけ・一覧（他の受け皿画面と同じ軸）── */}
      <div className="mb-6 mt-6">
        {/* ★きっかけ（自己申告の送客元）は出さない。LINEでは follow に経路が
            入らず測定できないので、上の「入口」が唯一の送客元の情報になる。
            測れないものを聞いて並べると、入口の数字と食い違って混乱する */}
        <ReceiverScreen stats={stats} showTrend={false} showOrigin={false} />
      </div>

      {/* ── 送客元の内訳 ── */}
      <h2 className="mb-2 text-[14px] font-semibold">どの型がLINEへ送ったか（Threads）</h2>
      <p className="mb-2 text-[12px] text-[var(--faint)]">
        ★LINE の follow イベントには経路情報が入らない（LINE の仕様）。
        「どの投稿が登録を生んだか」は原理的に取れないため、送客クリックで近似する。
      </p>
      {ch.byFormat.length === 0 ? (
        <p className="rounded-md bg-[var(--panel-2)] px-3 py-2 text-[12px] text-[var(--muted)]">
          まだ送客がありません（投稿にLINEへのリンクが貼られていません）。
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                <th className="px-3 py-2 font-medium">型</th>
                <th className="px-3 py-2 text-right font-medium">送客</th>
                <th className="px-3 py-2 text-right font-medium">投稿数</th>
                <th className="px-3 py-2 text-right font-medium">1投稿あたり</th>
              </tr>
            </thead>
            <tbody>
              {ch.byFormat.map((f) => (
                <tr key={f.format} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-3 py-2">{f.format}</td>
                  <td className="tnum px-3 py-2 text-right font-medium">{f.clicks}</td>
                  <td className="tnum px-3 py-2 text-right text-[var(--muted)]">{f.posts}</td>
                  <td className="tnum px-3 py-2 text-right text-[var(--muted)]">
                    {f.posts > 0 ? (f.clicks / f.posts).toFixed(1) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-[12px] text-[var(--faint)]">
        経路をまたいだ合計は{" "}
        <a className="text-[var(--accent)] underline" href="/leads">
          リード
        </a>
        。投稿別の送客は{" "}
        <a className="text-[var(--accent)] underline" href="/threads">
          Threads
        </a>{" "}
        の「→LINE」列。
      </p>
    </div>
  );
}

/** 入口1つ。未計装は 0 と区別して出す（§3） */
function EntranceCard({ e }: { e: Entrance }) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        e.clicks === null
          ? "border-[var(--warn)]/40 bg-[var(--warn)]/[0.06]"
          : "border-[var(--border)] bg-[var(--panel)]"
      }`}
    >
      <div className="text-[12px] font-medium text-[var(--muted)]">{e.label}</div>
      <div className="tnum mt-1 text-xl font-bold leading-none">
        {e.clicks === null ? (
          <span className="text-[13px] font-medium text-[var(--warn)]">
            {e.key === "unknown" ? "—(測定不能)" : "—(未計装)"}
          </span>
        ) : (
          e.clicks.toLocaleString("ja-JP")
        )}
      </div>
      <p className="mt-1 text-[10px] leading-tight text-[var(--faint)]">{e.note}</p>
    </div>
  );
}
