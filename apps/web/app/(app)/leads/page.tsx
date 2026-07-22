import {
  getLeads,
  getLeadStats,
  firstResponseMinutes,
  LEAD_TYPE_LABEL,
  LEAD_STATUS_LABEL,
  BUDGET_TIER_LABEL,
  getSourceBreakdown,
  type SourceBreakdown,
  type SourceRow,
} from "@/lib/leads";
import { LeadForm } from "./lead-form";
import { TrendChart } from "@/components/chart";
import {
  getAcquisitionMatrix,
  SENDERS,
  RECEIVERS,
  type AcquisitionMatrix,
} from "@/lib/acquisition";

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
  const [leads, stats, sources, matrix] = await Promise.all([
    getLeads(),
    getLeadStats(),
    getSourceBreakdown(),
    getAcquisitionMatrix(),
  ]);

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

      <SourcePanel data={sources} />
      <MatrixPanel m={matrix} />

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
 * 経路別のリード実績（§3.8.3 Lead.sourceType）。
 *
 * ★以前は「直客/代理店/LINE」（＝ゴールの種類）しか出しておらず、
 *   経路（どこから来たか）を画面に一度も出していなかった。
 *   さらに LINE だけ専用パネルを作り、経路の1つを特別扱いしていた。
 */
function SourcePanel({ data }: { data: SourceBreakdown }) {
  const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
  const yen = (v: number) => (v > 0 ? `¥${v.toLocaleString("ja-JP")}` : "—");
  const cell = (r: SourceRow) => (
    <>
      <Td className="text-right">
        {r.measured ? (
          <span className="tnum font-medium">{r.leads}</span>
        ) : (
          <span className="text-[11px] text-[var(--warn)]" title="この経路はまだ計測が始まっていない">
            未計測
          </span>
        )}
      </Td>
      <Td className="text-right">
        <span className="tnum">{r.won}</span>
      </Td>
      <Td className="text-right">
        <span className="tnum">{yen(r.wonAmount)}</span>
      </Td>
      <Td className="text-right">
        <span className="tnum">{pct(r.closeRate)}</span>
      </Td>
    </>
  );

  return (
    <section className="mb-5">
      <h2 className="mb-2 text-[14px] font-semibold">経路別（どこから来たか）</h2>
      <p className="mb-2 text-[12px] text-[var(--faint)]">
        ★「直客/代理店/LINE」はゴールの種類で、経路ではない。どの経路が獲得に
        効いているかは、この並びでしか判断できない。
        <br />
        ★このシステムのゴールは<strong>問い合わせ数を増やすこと</strong>。
        PV・クリック・到達はそのための手前の数字で、下の「送客 × 受け皿」で見る。
      </p>
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                <th className="whitespace-nowrap px-3 py-2 font-medium">経路</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">リード</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">成約</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">成約金額</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">成約率</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.key} className="border-b border-[var(--border)]">
                  <Td>{r.label}</Td>
                  {cell(r)}
                </tr>
              ))}
              <tr className="bg-[var(--panel-2)] font-semibold">
                <Td>{data.total.label}</Td>
                {cell(data.total)}
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-[var(--muted)]">
        <span>
          公式LINEの友だち:{" "}
          {data.lineFriends === null ? (
            <span className="text-[var(--warn)]">—（未計測）</span>
          ) : (
            <strong className="tnum">{data.lineFriends}</strong>
          )}
          <span className="text-[var(--faint)]">
            {" "}
            ※MMSが数えるのは Webhook 設置以降の登録のみ
          </span>
        </span>
        <span>
          Threads → LINE の送客:{" "}
          <strong className="tnum">{data.threadsToLineClicks}</strong>
          <span className="text-[var(--faint)]"> クリック（直近{data.days}日・経路の近似）</span>
        </span>
      </div>
    </section>
  );
}

/**
 * 送客 × 受け皿のマトリクス。
 *
 * ★目的は「どこが埋まっていないか」を出すこと。空欄を 0 で埋めると
 *   「送客していない」のか「測っていない」のか分からなくなる（§3）。
 * ★未計測（直せる）と測定不能（直せない）を分ける。混ぜると打ち手を誤る。
 */
function MatrixPanel({ m }: { m: AcquisitionMatrix }) {
  const at = (sender: string, receiver: string) =>
    m.cells.find((c) => c.sender === sender && c.receiver === receiver);

  return (
    <section className="mb-5">
      <h2 className="mb-2 text-[14px] font-semibold">
        送客 × 受け皿（直近{m.days}日）
      </h2>
      <p className="mb-2 text-[12px] text-[var(--faint)]">
        計測できているマス <strong className="tnum">{m.coverage.measured}</strong> /{" "}
        {m.coverage.target}（測定不能なマスは分母から除外）。
        <br />
        ★空欄を 0 で埋めない。「送客していない」のか「測っていない」のかが
        分からなくなる。<strong>未計測は直せるが、測定不能は直せない</strong>ので分けて出す。
      </p>
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                <th className="whitespace-nowrap px-3 py-2 font-medium">送客 ＼ 受け皿</th>
                {RECEIVERS.map((r) => (
                  <th key={r.key} className="whitespace-nowrap px-3 py-2 text-right font-medium">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SENDERS.map((s) => (
                <tr key={s.key} className="border-b border-[var(--border)]">
                  <Td className="font-medium">{s.label}</Td>
                  {RECEIVERS.map((r) => {
                    const c = at(s.key, r.key);
                    return (
                      <Td key={r.key} className="text-right">
                        <span title={c?.reason}>
                          {c?.state === "measured" ? (
                            <span className="tnum font-medium">
                              {(c.value ?? 0).toLocaleString("ja-JP")}
                            </span>
                          ) : c?.state === "not_measured" ? (
                            <span className="text-[11px] text-[var(--warn)]">未計測</span>
                          ) : c?.state === "unmeasurable" ? (
                            <span className="text-[11px] text-[var(--faint)]">測定不能</span>
                          ) : (
                            <span className="text-[11px] text-[var(--faint)]">—</span>
                          )}
                        </span>
                      </Td>
                    );
                  })}
                </tr>
              ))}
              <tr className="bg-[var(--panel-2)] font-semibold">
                <Td>リード（実績）</Td>
                {RECEIVERS.map((r) => (
                  <Td key={r.key} className="text-right">
                    <span className="tnum">{m.receiverTotals[r.key] ?? 0}</span>
                  </Td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="mt-2 text-[12px] text-[var(--faint)]">
        ★上段は「送った数（クリック・到達）」、最下段は「着地したリード数」。単位が違うので
        縦に足し引きしないこと。マスにカーソルを合わせると、その状態の理由が出ます。
      </p>
    </section>
  );
}
