import { getAgencyChannel } from "@/lib/channel-agency";
import { getAgencyData } from "@/lib/agency";
import { Stages } from "@/components/stages";
import { TrendChart } from "@/components/chart";
import { AgencySection } from "../threads/agency-section";

// 代理店（Threads DM ＋ 代理店LP）
//
// ★代理店開拓は1つの目的なのに経路が2つあり、DMが /threads、
//   代理店LPが /lp に分かれていたため「進んでいるか」を1画面で判断できなかった。
export const dynamic = "force-dynamic";

const jaDate = (d: Date) => d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });

export default async function AgencyPage() {
  const [ch, data] = await Promise.all([getAgencyChannel(), getAgencyData()]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">代理店</h1>
        <p className="mt-0.5 text-[13px] text-[var(--muted)]">
          直近{ch.days}日・経路は2つ（Threads DM ／ 代理店LP）。母数の単位が違うので合算しない
        </p>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="リード" value={ch.totals.leads} hint="両経路の合計" accent />
        <Stat label="契約" value={ch.totals.won} hint="status=won" />
        <Stat
          label="契約金額"
          value={ch.totals.wonAmount > 0 ? `¥${ch.totals.wonAmount.toLocaleString("ja-JP")}` : "—"}
          hint="closedAmount の合計"
        />
      </div>

      {ch.notes.map((n) => (
        <p
          key={n}
          className="mb-2 rounded-md bg-[var(--warn)]/12 px-3 py-2 text-[12px] text-[#9a6a00]"
        >
          ★{n}
        </p>
      ))}

      {/* ── 2つの階段 ── */}
      {ch.tracks.map((t) => (
        <section key={t.key} className="mb-6 mt-4">
          <h2 className="mb-2 text-[14px] font-semibold">{t.label}</h2>
          <Stages
            stages={t.stages}
            transitions={t.transitions}
            biggestDropIndex={t.biggestDropIndex}
          />
        </section>
      ))}

      {/* ── 推移 ── */}
      <h2 className="mb-2 mt-6 text-[14px] font-semibold">推移</h2>
      <div className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3.5">
        {/* ★桁が違うので軸を分ける。DMは月数件、LP訪問は日に十数件 */}
        <TrendChart
          series={[
            { label: "LP訪問", color: "#8aa0b8", points: ch.trends.visits },
            { label: "DM受信", color: "var(--accent)", points: ch.trends.dms, axis: "right" },
          ]}
        />
      </div>

      {/* ── アングル別 ── */}
      <h2 className="mb-2 text-[14px] font-semibold">アングル別（Threads DM）</h2>
      <p className="mb-2 text-[12px] text-[var(--faint)]">
        ★代理店募集の評価軸はDM獲得であって views ではない。対象が狭いので views は
        伸びないのが当然で、views で優劣を判断すると効いているアングルを切ることになる。
      </p>
      <Table
        head={["アングル", "投稿数", "DM", "DM/投稿"]}
        rows={ch.byAngle.map((a) => [
          a.angle,
          String(a.posts),
          String(a.dms),
          a.dmsPerPost === null ? "—" : a.dmsPerPost.toFixed(2),
        ])}
      />

      {/* ── コード別 ── */}
      <h2 className="mb-2 mt-6 text-[14px] font-semibold">配布コード別（代理店LP）</h2>
      <p className="mb-2 text-[12px] text-[var(--faint)]">
        ★「コード無し」は代理店経由でない訪問（検索・直打ち・OGP共有）も含む。
        LP側が全訪問にビーコンを送っているため、総訪問数のうち識別できた分だけが下の行。
      </p>
      {ch.byCode.length === 0 ? (
        <p className="rounded-md bg-[var(--panel-2)] px-3 py-2 text-[12px] text-[var(--muted)]">
          代理店LPのデータをまだ取得していません（訪問0ではありません）。
        </p>
      ) : (
        <Table
          head={["コード", "訪問", "問い合わせ", "最終流入"]}
          rows={ch.byCode.map((c) => [
            c.code === "direct" ? "コード無し" : c.code,
            String(c.visits),
            String(c.inquiries),
            `${c.idleDays}日前（${jaDate(c.lastAt)}）`,
          ])}
        />
      )}

      {/* ── DMの状態遷移と記録 ── */}
      <div className="mt-6">
        <AgencySection data={data} />
      </div>
    </div>
  );
}

function Table({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
              {head.map((h, i) => (
                <th
                  key={h}
                  className={`whitespace-nowrap px-3 py-2 font-medium ${i > 0 ? "text-right" : ""}`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r[0]} className="border-b border-[var(--border)] last:border-0">
                {r.map((c, i) => (
                  <td
                    key={i}
                    className={`whitespace-nowrap px-3 py-2 ${
                      i === 0 ? "" : "tnum text-right text-[var(--muted)]"
                    }`}
                  >
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string | number;
  hint: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
      <div className="text-[12px] text-[var(--muted)]">{label}</div>
      <div
        className={`tnum mt-1 text-2xl font-bold leading-none ${accent ? "text-[var(--accent)]" : ""}`}
      >
        {value}
      </div>
      <div className="mt-1 text-[11px] text-[var(--faint)]">{hint}</div>
    </div>
  );
}
