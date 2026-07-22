import { getLpData, type DailyPoint } from "@/lib/lp";

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

      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        <Stat label="記事PV" value={diagnosis.mediaPv.toLocaleString("ja-JP")} hint="LP到達率の分母" />
        <Stat
          label="LP到達（実人数）"
          value={diagnosis.totalUsers.toLocaleString("ja-JP")}
          hint={`イベント${diagnosis.totalViews}件（再訪を含む）`}
          accent
        />
        <Stat
          label="LP到達率"
          value={reachRate === null ? "—" : `${(reachRate * 100).toFixed(2)}%`}
          hint="目安 0.5%（下回ると記事側ボタンの問題）"
          bad={reachRate !== null && reachRate < 0.005}
        />
        <Stat
          label="問い合わせ"
          value={diagnosis.totalSubmits.toLocaleString("ja-JP")}
          hint={diagnosis.totalSubmits === 0 ? "★イベント未発火の可能性も確認" : "lp_form_submit"}
          bad={diagnosis.totalSubmits === 0}
        />
      </div>

      <p className="mb-3 rounded-md bg-[var(--warn)]/12 px-3 py-2 text-[12px] text-[#9a6a00]">
        {diagnosis.verdict}
      </p>

      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_360px]">
        <Panel title={`LP到達（実人数）の推移・${days}日`}>
          <BarChart data={diagnosis.daily} />
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
          <div className="mb-3 grid gap-3 sm:grid-cols-3">
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
          </div>

          <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_360px]">
            <Panel title={`訪問の推移・${days}日`}>
              <BarChart data={agency.daily} />
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
                ★「コード無し」が大半なら、配布URLが使われずLPに直接来ている。
                どの代理店の貢献か分からない状態で、代理店評価ができない。
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

/**
 * 日次の棒グラフ。
 * ★外部ライブラリを入れない（§2.1「バージョン依存で壊れない」）。
 *   日次の量が見えれば足りるので、インラインSVGで描く。
 */
function BarChart({ data }: { data: DailyPoint[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const W = 640;
  const H = 140;
  const pad = 18;
  const bw = (W - pad * 2) / data.length;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="日次推移">
        {/* 目盛り */}
        {[0, 0.5, 1].map((r) => (
          <g key={r}>
            <line
              x1={pad}
              x2={W - pad}
              y1={H - pad - (H - pad * 2) * r}
              y2={H - pad - (H - pad * 2) * r}
              stroke="currentColor"
              strokeWidth={0.5}
              className="text-[var(--border)]"
            />
            <text
              x={2}
              y={H - pad - (H - pad * 2) * r + 3}
              fontSize={9}
              fill="currentColor"
              className="text-[var(--faint)]"
            >
              {Math.round(max * r)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const h = (d.value / max) * (H - pad * 2);
          return (
            <rect
              key={d.date}
              x={pad + i * bw + bw * 0.15}
              y={H - pad - h}
              width={bw * 0.7}
              height={h}
              rx={1}
              className="fill-[var(--accent)]"
            >
              <title>{`${d.date}: ${d.value}`}</title>
            </rect>
          );
        })}
        <text x={pad} y={H - 5} fontSize={9} fill="currentColor" className="text-[var(--faint)]">
          {data[0]?.date.slice(5)}
        </text>
        <text
          x={W - pad}
          y={H - 5}
          fontSize={9}
          textAnchor="end"
          fill="currentColor"
          className="text-[var(--faint)]"
        >
          {data[data.length - 1]?.date.slice(5)}
        </text>
      </svg>
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
