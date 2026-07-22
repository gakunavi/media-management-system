import { getLineChannel } from "@/lib/channel-line";
import { TrendChart } from "@/components/chart";
import { Stages } from "@/components/stages";

// 公式LINE（設計書 §4.1 段1③）
//
// ★/leads は「どの経路が何件取れたか」の総合。ここは経路の中身で、
//   どの段で落ちているかを見る画面。落ちている段が分かれば打ち手が決まる。
export const dynamic = "force-dynamic";

export default async function LinePage() {
  const ch = await getLineChannel();

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">公式LINE</h1>
        <p className="mt-0.5 text-[13px] text-[var(--muted)]">
          直近{ch.days}日・送客 → 登録 → 反応 → 問い合わせ → 成約
        </p>
      </div>

      {ch.notMeasured.length > 0 && (
        <p className="mb-4 rounded-md bg-[var(--warn)]/12 px-3 py-2 text-[12px] text-[#9a6a00]">
          ★未計測の段があります: {ch.notMeasured.join(" / ")}。
          これらの 0 は「成果ゼロ」ではありません。
        </p>
      )}

      {/* ── 階段 ── */}
      <h2 className="mb-2 text-[14px] font-semibold">どこで落ちているか</h2>
      <Stages
        stages={ch.stages}
        transitions={ch.transitions}
        biggestDropIndex={ch.biggestDropIndex}
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

      {/* ── 送客元の内訳 ── */}
      <h2 className="mb-2 text-[14px] font-semibold">どの型がLINEへ送ったか</h2>
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

