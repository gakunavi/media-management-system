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

      {/* ── 代理店LP ─────────────────────────────── */}
      <h2 className="mb-2 mt-6 text-[14px] font-semibold">
        代理店LP（防災防犯ライト・配布コード別）
      </h2>
      <p className="mb-2 text-[12px] text-[var(--faint)]">
        ★診断LPとは評価軸が違う。ここで見るのは「配ったコードが動いているか」で、
        訪問数の多寡ではない。0のコードは<strong>配布したが使われていない</strong>という情報。
      </p>

      {!agency.measured ? (
        <p className="rounded-md bg-[var(--warn)]/12 px-3 py-2 text-[12px] text-[#9a6a00]">
          代理店LPのデータをまだ取得していません（訪問0ではありません）。
        </p>
      ) : (
        <>
          <div className="mb-3 grid gap-3 sm:grid-cols-4">
            <Stat label="訪問" value={agency.totalVisits.toLocaleString("ja-JP")} hint={`${days}日間`} accent />
            <Stat
              label="問い合わせ"
              value={agency.totalInquiries.toLocaleString("ja-JP")}
              hint="テスト送信は除外済み"
            />
            <Stat
              label="稼働コード"
              value={String(agency.codes.filter((c) => c.code !== "direct").length)}
              hint="流入が1件以上あったコード"
            />
            <Stat
              label="リード"
              value={agency.leads.toLocaleString("ja-JP")}
              hint={`成約 ${agency.won}件${agency.wonAmount > 0 ? ` / ¥${agency.wonAmount.toLocaleString("ja-JP")}` : ""}`}
            />
          </div>

          <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_360px]">
            <Panel title={`訪問の推移・${days}日`}>
              <TrendChart
              series={[{ label: "訪問", color: "var(--accent)", points: agency.daily }]}
              height={160}
            />
            </Panel>
            <Panel title="コード別">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[12px] text-[var(--muted)]">
                    <th className="py-1.5 font-medium">コード</th>
                    <th className="py-1.5 text-right font-medium">訪問</th>
                    <th className="py-1.5 text-right font-medium">問合せ</th>
                    <th className="py-1.5 text-right font-medium">最終</th>
                  </tr>
                </thead>
                <tbody>
                  {agency.codes.map((c) => (
                    <tr key={c.code} className="border-b border-[var(--border)] last:border-0">
                      <td className="py-1.5 font-mono text-[12px]">
                        {c.code === "direct" ? (
                          <span className="text-[var(--muted)]">コード無し</span>
                        ) : (
                          c.code
                        )}
                      </td>
                      <td className="tnum py-1.5 text-right font-medium">{c.visits}</td>
                      <td className="tnum py-1.5 text-right text-[var(--muted)]">{c.inquiries}</td>
                      <td
                        className={`tnum py-1.5 text-right text-[12px] ${
                          c.idleDays >= 7 ? "text-[var(--bad)]" : "text-[var(--muted)]"
                        }`}
                        title={jaDate(c.lastAt)}
                      >
                        {c.idleDays}日前
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] leading-relaxed text-[var(--faint)]">
                ★「コード無し」は代理店経由でない訪問（検索・直打ち・OGP共有など）も
                含む。LP側が全訪問にビーコンを送っているため、189は総訪問数で、
                そのうち代理店経由と識別できるのが37。
                <br />
                ★コードは sessionStorage 保持のためタブを閉じると消える。
                LINE/メールで受け取り、後日あらためて開いて問い合わせると
                コードが失われる（要 localStorage + Cookie 化）。
              </p>
            </Panel>
          </div>
        </>
      )}
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
      <div className="mt-1 text-[11px] text-[var(--faint)]">{hint}</div>
    </div>
  );
}
