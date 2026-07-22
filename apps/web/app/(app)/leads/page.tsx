import {
  getLeads,
  getLeadStats,
  firstResponseMinutes,
  LEAD_TYPE_LABEL,
  LEAD_STATUS_LABEL,
  BUDGET_TIER_LABEL,
  getLineStats,
  type LineStats,
} from "@/lib/leads";
import { LeadForm } from "./lead-form";
import { TrendChart } from "@/components/chart";

// リード一覧（設計書 §4.2 /leads・§14.3）
export const dynamic = "force-dynamic";

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
const jaDate = (d: Date) =>
  d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });

function statusBadge(status: string): string {
  switch (status) {
    case "won":
      return "bg-[var(--ok)]/12 text-[#1a7a2e]";
    case "lost":
      return "bg-[var(--bad)]/12 text-[var(--bad)]";
    case "new":
      return "bg-[var(--warn)]/15 text-[#9a6a00]";
    default:
      return "bg-[var(--accent-weak)] text-[var(--accent)]";
  }
}

export default async function LeadsPage() {
  const [leads, stats, line] = await Promise.all([getLeads(), getLeadStats(), getLineStats()]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">リード</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            問い合わせ・成約の一覧。★最優先は直客（§14.0）
          </p>
        </div>
        <LeadForm />
      </div>

      {/* サマリー */}
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="直客" value={stats.byType.direct_inquiry ?? 0} accent />
        <Stat label="代理店" value={stats.byType.agency ?? 0} />
        <Stat label="LINE" value={stats.byType.line_friend ?? 0} />
        <Stat
          label="経路特定率"
          value={
            stats.pathIdentifiedRate === null
              ? "—"
              : `${Math.round(stats.pathIdentifiedRate * 100)}%`
          }
          hint="§1.1 成功指標①（目標100%）"
        />
      </div>

      <LinePanel line={line} />

      {/* 成約サマリー */}
      {stats.won > 0 && (
        <div className="mb-4 rounded-lg border border-[var(--ok)]/30 bg-[var(--ok)]/[0.06] px-4 py-2.5 text-[13px]">
          <span className="font-medium text-[#1a7a2e]">成約 {stats.won}件</span>
          <span className="text-[var(--muted)]"> ・ {yen(stats.wonAmount)}（税抜）</span>
        </div>
      )}

      {/* テーブル */}
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        {leads.length === 0 ? (
          <div className="p-10 text-center text-[13px] text-[var(--faint)]">
            まだリードがありません。右上「＋ リードを手動登録」または WPフォーム接続で入ります。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                  <Th>発生日</Th>
                  <Th>種別</Th>
                  <Th>状態</Th>
                  <Th>予算</Th>
                  <Th>興味商材</Th>
                  <Th>比較商材</Th>
                  <Th>流入記事</Th>
                  <Th>初動</Th>
                  <Th>成約額</Th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => {
                  const fr = firstResponseMinutes(l);
                  return (
                    <tr
                      key={l.id}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--panel-2)]"
                    >
                      <Td>{jaDate(l.occurredAt)}</Td>
                      <Td>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                            l.type === "direct_inquiry"
                              ? "bg-[var(--accent-weak)] text-[var(--accent)]"
                              : "bg-[var(--panel-2)] text-[var(--muted)]"
                          }`}
                        >
                          {LEAD_TYPE_LABEL[l.type] ?? l.type}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${statusBadge(l.status)}`}
                        >
                          {LEAD_STATUS_LABEL[l.status] ?? l.status}
                        </span>
                      </Td>
                      <Td className="text-[var(--muted)]">
                        {BUDGET_TIER_LABEL[l.budgetTier]?.split("（")[0] ?? l.budgetTier}
                      </Td>
                      <Td>{l.interestProduct.join("・") || "—"}</Td>
                      <Td className="text-[var(--muted)]">
                        {l.competitorsConsidered.join("・") || "—"}
                      </Td>
                      <Td>
                        {l.firstTouchExternalId ? (
                          <span className="font-mono text-[12px]">
                            {l.firstTouchExternalId}
                          </span>
                        ) : (
                          <span className="text-[var(--warn)]">経路不明</span>
                        )}
                      </Td>
                      <Td className="text-[var(--muted)]">
                        {fr === null ? "—" : fr < 60 ? `${fr}分` : `${Math.round(fr / 60)}時間`}
                      </Td>
                      <Td className="tnum">
                        {l.closedAmount ? yen(Number(l.closedAmount)) : "—"}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-3 text-[12px] text-[var(--faint)]">
        個人情報（会社名・連絡先・メモ）は AES-256-GCM で暗号化して保存し、画面ではマスキング表示（§16.2）。
        商談以降は m2（ML営業管理システム）が正（§3.8.4）。
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3.5">
      <div className="text-[12px] text-[var(--muted)]">{label}</div>
      <div
        className={`tnum mt-1 text-2xl font-bold leading-none ${accent ? "text-[var(--accent)]" : ""}`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-[10px] text-[var(--faint)]">{hint}</div>}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-3 py-2 font-medium">{children}</th>;
}
function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`whitespace-nowrap px-3 py-2.5 ${className}`}>{children}</td>;
}

/**
 * 公式LINE の数値（PDCA用）。
 * ★MMS が持つのは「数」だけ。会話の中身は LINE 公式アカウント側にある。
 *   見たいのは 登録 → 問い合わせ → 成約 → 金額 の落ち方。
 */
function LinePanel({ line }: { line: LineStats }) {
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
  return (
    <section className="mb-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[14px] font-semibold">公式LINE（直近{line.days}日）</h2>
        {line.unhandled > 0 && (
          <span className="rounded-md bg-[var(--bad)]/10 px-2 py-1 text-[12px] font-medium text-[var(--bad)]">
            ● 未対応 {line.unhandled}件
          </span>
        )}
      </div>

      {!line.measured && (
        <p className="mb-2 rounded-md bg-[var(--warn)]/12 px-3 py-2 text-[12px] text-[#9a6a00]">
          ★LINE登録の計測開始が未記録です。ここの数字は 0 ではなく「まだ測っていない」
          状態を含みます（Webhook で最初の登録が入ると計測が始まります）。
        </p>
      )}

      <div className="mb-3 grid gap-3 sm:grid-cols-6">
        <Stat
          label="友だち登録"
          value={line.friends}
          hint={`うち直近${line.days}日 ${line.friendsInPeriod}件`}
          accent
        />
        <Stat label="メッセージ受信" value={line.inbounds} hint="スタンプ等も含む全件" />
        <Stat
          label="問い合わせ"
          value={line.inquiries}
          hint="商談になりうるものを起票した数"
        />
        <Stat label="成約" value={line.won} hint="LINE経由のリード" />
        <Stat
          label="成約金額"
          value={line.wonAmount > 0 ? `¥${line.wonAmount.toLocaleString("ja-JP")}` : "—"}
          hint="closedAmount の合計"
        />
        <Stat
          label="転換率"
          value={`${pct(line.inquiryRate)} → ${pct(line.closeRate)}`}
          hint="登録→問い合わせ→成約。母数0なら—"
        />
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-3.5">
        <div className="mb-1 text-[12px] font-medium text-[var(--muted)]">
          問い合わせの推移
        </div>
        <TrendChart
          series={[{ label: "問い合わせ", color: "var(--accent)", points: line.daily }]}
          height={140}
        />
      </div>
    </section>
  );
}
