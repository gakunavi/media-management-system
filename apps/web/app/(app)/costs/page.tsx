import { getTools } from "@/lib/tools";
import { ToolList } from "./tool-list";

// コスト管理（2026-07-21 追加）。
// ★ROIは自動算出しない。ツール単位の売上寄与は分解不能で、算出すれば
//   根拠のない数字が出る。導入時に目的と判定期日を書き、期日に人が判定する。
export const dynamic = "force-dynamic";

export default async function CostsPage() {
  const { rows, monthlyTotalYen, monthlyUnknown, overdueCount } = await getTools();

  const active = rows.filter((t) => t.state === "active").length;
  const trial = rows.filter((t) => t.state === "trial").length;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">コスト</h1>
        <p className="mt-0.5 text-[13px] text-[var(--muted)]">
          メディア運用に使っているツールと、その目的・判定
        </p>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Stat
          label="月額合計"
          value={`¥${monthlyTotalYen.toLocaleString("ja-JP")}`}
          hint={
            monthlyUnknown > 0
              ? `★月額未入力が${monthlyUnknown}件あり、実際はこれより高い`
              : "契約中＋トライアル"
          }
          bad={monthlyUnknown > 0}
        />
        <Stat label="契約中 / トライアル" value={`${active} / ${trial}`} hint="停止したものは除く" />
        <Stat
          label="判定期日超過"
          value={String(overdueCount)}
          hint={overdueCount > 0 ? "惰性で払い続けている可能性" : "期限切れなし"}
          bad={overdueCount > 0}
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
