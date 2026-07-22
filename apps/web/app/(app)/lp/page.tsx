import { getLpData } from "@/lib/lp";
import { TrendChart } from "@/components/chart";
import { Stages } from "@/components/stages";

// LP（診断LP・代理店LP）— 設計書 §3.8.6 / PRJ-034
//
// ★元は cowork の media-console が持っていた画面。データ源を MMS に移したので
//   画面もこちらへ。判断する場所と数字がある場所を1つにする。
export const dynamic = "force-dynamic";

const jaDate = (d: Date) => d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });

export default async function LpPage() {
  const { diagnosis, agency, days } = await getLpData();

  // LP到達率（記事PV基準）。cowork の診断ロジックと同じ 0.5% を目安にする
  const reachRate = diagnosis.mediaPv > 0 ? diagnosis.totalUsers / diagnosis.mediaPv : null;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">LP</h1>
        <p className="mt-0.5 text-[13px] text-[var(--muted)]">
          直近{days}日・診断LP（自社）と代理店LP（外部ドメイン）は評価軸が違うので分けて出す
        </p>
      </div>

      {/* ── 診断LP ───────────────────────────────── */}
      <h2 className="mb-2 text-[14px] font-semibold">診断LP（記事 → LP → 問い合わせ）</h2>

      <Stages
        stages={diagnosis.stages}
        transitions={diagnosis.transitions}
        biggestDropIndex={diagnosis.biggestDropIndex}
      />

      <div className="my-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-[var(--muted)]">
        <span>
          LP到達率{" "}
          <strong className="tnum">
            {reachRate === null ? "—" : `${(reachRate * 100).toFixed(2)}%`}
          </strong>
          <span className="text-[var(--faint)]"> ／ 目安 0.5%（下回ると記事側ボタンの問題）</span>
        </span>
        <span>
          到達イベント <strong className="tnum">{diagnosis.totalViews}</strong>
          <span className="text-[var(--faint)]">（再訪を含む。実人数と別）</span>
        </span>
        <span>
          成約金額{" "}
          <strong className="tnum">
            {diagnosis.wonAmount > 0 ? `¥${diagnosis.wonAmount.toLocaleString("ja-JP")}` : "—"}
          </strong>
        </span>
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_360px]">
        <Panel title={`LP到達（実人数）の推移・${days}日`}>
          <TrendChart
            series={[{ label: "LP到達（実人数）", color: "var(--accent)", points: diagnosis.daily }]}
            height={160}
          />
        </Panel>
        <Panel title="パターン別">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[12px] text-[var(--muted)]">
                <th className="py-1.5 font-medium">パターン</th>
                <th className="py-1.5 text-right font-medium">実人数</th>
                <th className="py-1.5 text-right font-medium">到達</th>
                <th className="py-1.5 text-right font-medium">問合せ</th>
              </tr>
            </thead>
            <tbody>
              {diagnosis.variants.map((v) => (
                <tr key={v.key} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-1.5">{v.label}</td>
                  <td className="tnum py-1.5 text-right font-medium">{v.users}</td>
                  <td className="tnum py-1.5 text-right text-[var(--muted)]">{v.views}</td>
                  <td className="tnum py-1.5 text-right text-[var(--muted)]">{v.submits}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--faint)]">
            ★実人数と到達（イベント数）は別物。同じ人が再訪すると到達だけ増える。
            パターンの優劣は<strong>実人数</strong>で見ること。
          </p>
        </Panel>
      </div>

      <p className="mt-6 rounded-md bg-[var(--panel-2)] px-3 py-2 text-[12px] text-[var(--muted)]">
        代理店LP（防災防犯ライト）は{" "}
        <a className="text-[var(--accent)] underline" href="/agency">
          代理店
        </a>{" "}
        にまとめました。自社の診断LPとは目的も母数の単位も違うためです。
      </p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3.5">
      <div className="mb-2 text-[12px] font-medium text-[var(--muted)]">{title}</div>
      {children}
    </div>
  );
}
