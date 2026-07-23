import Link from "next/link";
import { getTools, type ToolRow } from "@/lib/tools";
import { ToolList } from "./tool-list";

// コスト管理（2026-07-21 追加）。
// ★ROIは自動算出しない。ツール単位の売上寄与は分解不能で、算出すれば
//   根拠のない数字が出る。導入時に目的と判定期日を書き、期日に人が判定する。
export const dynamic = "force-dynamic";

export default async function CostsPage() {
  const { rows, monthlyTotalYen, monthlyUnknown, overdueCount, noDueDateCount, runningOut } =
    await getTools();

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

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {/* ★¥0 を「無料で運用している」と読ませない。
            前払い/従量（DataForSEO・OpenAI）はここに入らない */}
        <Stat
          label="固定の月額"
          value={`¥${monthlyTotalYen.toLocaleString("ja-JP")}`}
          hint={
            monthlyUnknown > 0
              ? `★月額未入力が${monthlyUnknown}件あり、実際はこれより高い`
              : `★前払い/従量（${prepaid}件）は含まない。使った分だけかかる`
          }
          bad={monthlyUnknown > 0}
        />
        <Stat label="契約中 / トライアル" value={`${active} / ${trial}`} hint="停止したものは除く" />
        {/* ★「超過0＝問題なし」と読ませない。実際は期日を1件も決めていないから0だった */}
        <Stat
          label="判定期日"
          value={
            noDueDateCount > 0
              ? `未設定 ${noDueDateCount}件`
              : overdueCount > 0
                ? `超過 ${overdueCount}件`
                : "期限内"
          }
          hint={
            noDueDateCount > 0
              ? "★期日が無いと「惰性で払い続けている」を検出できない"
              : overdueCount > 0
                ? "惰性で払い続けている可能性"
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

      <p className="mt-5 text-[12px] leading-relaxed text-[var(--faint)]">
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
