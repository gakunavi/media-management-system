import Link from "next/link";
import { NOT_MEASURED } from "@mms/shared";
import { getTools, type ToolRow } from "@/lib/tools";
import { ToolList } from "./tool-list";

// コスト管理（2026-07-21 追加）。
// ★ROIは自動算出しない。ツール単位の売上寄与は分解不能で、算出すれば
//   根拠のない数字が出る。導入時に目的と判定期日を書き、期日に人が判定する。
export const dynamic = "force-dynamic";

export default async function CostsPage() {
  const {
    rows,
    monthlyTotalYen,
    monthlyUnknown,
    overdueCount,
    noDueDateCount,
    runningOut,
    potentialMonthlyYen,
    trend,
    sharedCount,
  } = await getTools();

  const active = rows.filter((t) => t.state === "active").length;
  const trial = rows.filter((t) => t.state === "trial").length;
  const prepaid = rows.filter(
    (t) => t.billingType === "prepaid" && t.state !== "stopped",
  ).length;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">コスト</h1>
        <p className="mt-0.5 text-[13px] text-[var(--muted)]">
          メディア運用に使っているツールと、その目的・判定
        </p>
      </div>

      <RunningOutPanel rows={runningOut} />
      <CostTrendPanel trend={trend} potential={potentialMonthlyYen} current={monthlyTotalYen} />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {/* ★¥0 を「無料で運用している」と読ませない。
            前払い/従量（DataForSEO・OpenAI）はここに入らない */}
        {/* ★出すのは「メディアのための追加コスト」。総支出ではない。
            自社既存（エックスサーバー等）はメディアのために契約したものではないので
            コスパ判定の対象にならない。ただし止まれば影響するので一覧には残す */}
        <Stat
          label="メディアのための月額"
          value={`¥${monthlyTotalYen.toLocaleString("ja-JP")}`}
          hint={
            monthlyUnknown > 0
              ? `★月額未入力が${monthlyUnknown}件あり、実際はこれより高い`
              : `前払い/従量${prepaid}件・自社既存${sharedCount}件は含まない`
          }
          bad={monthlyUnknown > 0}
        />
        <Stat label="契約中 / トライアル" value={`${active} / ${trial}`} hint="停止したものは除く" />
        {/* ★「超過0＝問題なし」と読ませない。実際は期日を1件も決めていないから0だった */}
        <Stat
          label="見直し予定日"
          value={
            noDueDateCount > 0
              ? `未設定 ${noDueDateCount}件`
              : overdueCount > 0
                ? `過ぎている ${overdueCount}件`
                : "全て予定日前"
          }
          hint={
            noDueDateCount > 0
              ? "★いつ「続けるか止めるか」を決めるかが未定"
              : overdueCount > 0
                ? "決める日が来ているのに未判断"
                : "全て期限内"
          }
          bad={noDueDateCount > 0 || overdueCount > 0}
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-8 text-center">
          <p className="text-[13px] text-[var(--muted)]">
            まだ登録がありません。[ツールを追加] から、いま使っているものを登録してください。
          </p>
        </div>
      ) : (
        <ToolList rows={rows} />
      )}

      {/* ★用語をそのまま出さない。何を決める日なのかを書く */}
      <section className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-4 text-[12px] leading-relaxed text-[var(--muted)]">
        <h2 className="mb-1 text-[13px] font-semibold text-[var(--ink)]">
          「見直し予定日」とは
        </h2>
        <p>
          そのツールを<strong>続けるか止めるかを決める日</strong>です。導入するときに
          「何のために入れるか（目的）」「何が良くなれば続けるか（期待）」と一緒に決めておき、
          その日が来たら実績を見て判断します。
          <br />
          ★決めておかないと<strong>誰も止めどきを判断せず、払い続けます</strong>。
          いまは<strong>{noDueDateCount}件すべてが未設定</strong>なので、
          この画面は「使っているものの一覧」でしかなく、コスパの判定ができません。
          各ツールの「続ける/止めるを判定する」から日付を入れてください。
        </p>
      </section>

      <p className="mt-4 text-[12px] leading-relaxed text-[var(--faint)]">
        ★<strong>効果（ROI）は自動算出しません。</strong>
        「このツールが何円の売上を生んだか」は分解できず、算出すれば根拠のない数字になります。
        代わりに導入時に<strong>目的</strong>と<strong>判定期日</strong>を書き、期日に人が判定します
        （施策・PDCA と同じ形）。判定には根拠を必須にしています。
        <br />
        残高は DataForSEO のように API で取得できるものだけ自動更新されます（日次）。
      </p>
    </div>
  );
}

/**
 * 残高が次回の実行に足りないツール。
 *
 * ★金額だけでは判断できない。「残高 $0.1372」と書いてあっても、
 *   それが多いのか少ないのか分からない。実際は次回の実行に $0.24 かかるので
 *   **途中で止まる**。金額ではなく「あと何回動くか」「止まると何が測れなくなるか」を出す。
 */
/**
 * 月額の推移と、検討中を入れたときの見込み。
 *
 * ★ツールは足すのは簡単で止めるのは忘れるので、合計は放っておくと単調に増える。
 *   「1つ足すくらい」の判断を積み重ねて気づけば倍になっている、を防ぐ。
 * ★計測開始より前の月は**未計測**であって0円ではない。描かない（§3）。
 */
function CostTrendPanel({
  trend,
  potential,
  current,
}: {
  trend: { period: string; activeYen: number; plannedYen: number; tools: number }[];
  potential: number;
  current: number;
}) {
  const max = Math.max(1, ...trend.map((t) => t.activeYen + t.plannedYen), potential);
  return (
    <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-[14px] font-semibold">固定月額の推移</h2>
        {potential > current && (
          <span className="text-[12px] text-[var(--muted)]">
            検討中・トライアルを全部契約すると{" "}
            <strong className="tnum text-[var(--warn)]">
              ¥{potential.toLocaleString("ja-JP")}
            </strong>
            （いま ¥{current.toLocaleString("ja-JP")}）
          </span>
        )}
      </div>
      {trend.length === 0 ? (
        <p className="mt-2 text-[13px] text-[var(--faint)]">
          {NOT_MEASURED}（記録はこれから貯まります）
        </p>
      ) : (
        <>
          <div className="mt-3 flex items-end gap-3">
            {trend.map((t) => {
              const total = t.activeYen + t.plannedYen;
              return (
                <div key={t.period} className="flex flex-col items-center gap-1">
                  <span className="tnum text-[11px] text-[var(--muted)]">
                    ¥{total.toLocaleString("ja-JP")}
                  </span>
                  <div
                    className="w-12 rounded-t bg-[var(--accent)]"
                    style={{ height: `${Math.max(4, (total / max) * 64)}px` }}
                  />
                  <span className="text-[11px] text-[var(--faint)]">{t.period}</span>
                  <span className="text-[10px] text-[var(--faint)]">{t.tools}件</span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-[var(--faint)]">
            ★記録は {trend[0].period} から。それ以前は
            <strong>未計測</strong>（0円ではない）なので描いていません。
          </p>
        </>
      )}
    </section>
  );
}

function RunningOutPanel({ rows }: { rows: ToolRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="mb-4 rounded-xl border border-[var(--bad)]/40 bg-[var(--bad)]/[0.06] p-4">
      <h2 className="text-[14px] font-semibold text-[var(--bad)]">
        次回の実行ぶんに残高が足りない（{rows.length}件）
      </h2>
      <div className="mt-2 grid gap-2">
        {rows.map((t) => (
          <div key={t.id} className="text-[13px]">
            <div className="font-medium">
              {t.name}
              <span className="tnum ml-2 text-[12px] text-[var(--muted)]">
                残高 {t.balance?.toLocaleString("ja-JP")} {t.balanceCurrency}
                {t.power?.costPerRun ? ` ／ 1回 $${t.power.costPerRun}` : ""}
                {t.runsLeft !== null && `（あと ${t.runsLeft} 回分）`}
              </span>
            </div>
            {t.power && (
              <ul className="mt-0.5 text-[12px] text-[var(--muted)]">
                {t.power.jobs.map((j) => (
                  <li key={j.name}>
                    ・止まる処理: <span className="font-mono text-[11px]">{j.name}</span> {j.label}
                  </li>
                ))}
                <li>・測れなくなること: {t.power.losesWhat}</li>
              </ul>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-[var(--muted)]">
        <Link href="/jobs" className="text-[var(--accent)] hover:underline">
          自動処理 →
        </Link>
      </p>
    </section>
  );
}

function Stat({
  label,
  value,
  hint,
  bad,
}: {
  label: string;
  value: string;
  hint: string;
  bad?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
      <div className="text-[12px] text-[var(--muted)]">{label}</div>
      <div className={`tnum mt-1 text-2xl font-bold leading-none ${bad ? "text-[var(--bad)]" : ""}`}>
        {value}
      </div>
      <div className="mt-1 text-[10px] text-[var(--faint)]">{hint}</div>
    </div>
  );
}
