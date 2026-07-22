// 受け皿の個別画面（HPの問い合わせ／電話）
//
// ★見るのは3つ（2026-07-23 石井さん）
//   1. 代理店見込みと見込み客のどちらが多いか
//   2. 期間を切った実績
//   3. その場で追加登録できること
//
// ★どの受け皿でも同じ並びにする。受け皿ごとに読み方が変わると比較できない。
import Link from "next/link";
import { NOT_MEASURED } from "@mms/shared";
import { TrendChart } from "@/components/chart";
import { LEAD_STATUS_LABEL } from "@/lib/leads";
import type { ReceiverStats } from "@/lib/receivers";

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;
const jaDate = (d: Date) =>
  d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });

function Delta({ now, prev }: { now: number; prev: number }) {
  const d = now - prev;
  const cls = d > 0 ? "text-[#1a7a2e]" : d < 0 ? "text-[var(--bad)]" : "text-[var(--faint)]";
  return (
    <span className={`tnum text-[11px] ${cls}`}>
      前期間比 {d > 0 ? `+${d}` : d === 0 ? "±0" : d}
    </span>
  );
}

export function ReceiverScreen({
  stats,
  note,
}: {
  stats: ReceiverStats;
  /** その受け皿に固有の注意書き（計測の限界など） */
  note?: string;
}) {
  return (
    <div className="grid gap-4">
      {!stats.measured && (
        <p className="rounded-md bg-[var(--warn)]/12 px-3 py-2 text-[12px] text-[#9a6a00]">
          ★この受け皿はまだ計測開始が記録されていません。件数は
          <strong>0件ではなく未計測</strong>として扱っています（§3）。
          1件登録すると計測開始が記録されます。
        </p>
      )}
      {note && (
        <p className="rounded-md bg-[var(--panel-2)] px-3 py-2 text-[12px] text-[var(--muted)]">
          ★{note}
        </p>
      )}

      {/* ── 種別（この画面の主目的）── */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="text-[15px] font-semibold">種別（何を募集した結果か）</h2>
        <p className="mb-3 mt-0.5 text-[12px] text-[var(--faint)]">
          ★同じ受け皿でも、見込み客と代理店見込みでは打ち手が違う（商談 と 選別・取次）。
          どちらが多いかで、その受け皿に何を載せるかが決まる。
        </p>
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat
            label="合計"
            value={stats.measured ? String(stats.total) : NOT_MEASURED}
            sub={<Delta now={stats.total} prev={stats.prevTotal} />}
            accent
          />
          {stats.byKind.map((k) => (
            <Stat
              key={k.key}
              label={k.label}
              value={String(k.leads)}
              sub={<Delta now={k.leads} prev={k.prevLeads} />}
              hint={k.won > 0 ? `成約 ${k.won}件 ${yen(k.wonAmount)}` : undefined}
            />
          ))}
        </div>
      </section>

      {/* ── きっかけ ── */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="text-[15px] font-semibold">きっかけ（どの施策に触れて来たか）</h2>
        <p className="mb-3 mt-0.5 text-[12px] text-[var(--faint)]">
          ★いきなり連絡してくる人はほとんどおらず、何かの施策に触れている。
          聞いて記録すれば、この受け皿も施策の成果として数えられる。
          {stats.unknownRate !== null && stats.unknownRate > 0 && (
            <>
              {" "}
              いま{" "}
              <strong className="text-[var(--warn)]">
                {Math.round(stats.unknownRate * 100)}%
              </strong>{" "}
              が「不明」＝ヒアリングできていない。
            </>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {stats.byOrigin.map((o) => (
            <div
              key={o.key}
              className={`rounded-md border px-3 py-2 text-[12px] ${
                o.key === "unknown" && o.leads > 0
                  ? "border-[var(--warn)]/40 bg-[var(--warn)]/[0.08] text-[#9a6a00]"
                  : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]"
              }`}
            >
              {o.label} <strong className="tnum ml-1">{o.leads}</strong>
            </div>
          ))}
        </div>
      </section>

      {/* ── 推移 ── */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="mb-2 text-[15px] font-semibold">推移（{stats.days}日）</h2>
        <TrendChart
          series={[{ label: "問い合わせ", color: "var(--accent)", points: stats.trend }]}
          height={150}
        />
      </section>

      {/* ── 一覧 ── */}
      <section>
        <h2 className="mb-2 text-[14px] font-semibold">この受け皿のリード（{stats.leads.length}件）</h2>
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
          {stats.leads.length === 0 ? (
            <p className="p-8 text-center text-[13px] text-[var(--faint)]">
              この期間の記録はありません。右上の「＋ 記録する」から追加できます。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                    <Th>発生日</Th>
                    <Th>種別</Th>
                    <Th>きっかけ</Th>
                    <Th>会社</Th>
                    <Th>連絡先</Th>
                    <Th>状態</Th>
                    <Th right>成約額</Th>
                  </tr>
                </thead>
                <tbody>
                  {stats.leads.map((l) => (
                    <tr key={l.id} className="border-b border-[var(--border)] last:border-0">
                      <Td>{jaDate(l.occurredAt)}</Td>
                      <Td>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                            l.type === "agency"
                              ? "bg-[var(--panel-2)] text-[var(--muted)]"
                              : "bg-[var(--accent-weak)] text-[var(--accent)]"
                          }`}
                        >
                          {l.type === "agency"
                            ? "代理店見込み"
                            : l.type === "line_friend"
                              ? "LINE登録"
                              : "見込み客"}
                        </span>
                      </Td>
                      <Td className={l.origin === "unknown" ? "text-[var(--warn)]" : ""}>
                        {l.originLabel}
                      </Td>
                      <Td className="text-[var(--muted)]">{l.companyMasked}</Td>
                      <Td className="text-[var(--muted)]">{l.contactMasked}</Td>
                      <Td>{LEAD_STATUS_LABEL[l.status] ?? l.status}</Td>
                      <Td className="tnum text-right">
                        {l.closedAmount ? yen(Number(l.closedAmount)) : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <p className="mt-2 text-[12px] text-[var(--faint)]">
          個人情報は暗号化して保存し、画面ではマスキング表示（§16.2）。全経路をまとめて見るときは{" "}
          <Link href="/leads" className="text-[var(--accent)] hover:underline">
            リード統計
          </Link>
          。
        </p>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  hint,
  accent,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-4 ${
        accent
          ? "border-[var(--accent)]/40 bg-[var(--accent-weak)]"
          : "border-[var(--border)] bg-[var(--panel-2)]"
      }`}
    >
      <div className="text-[13px] text-[var(--muted)]">{label}</div>
      <div className="tnum mt-1 text-3xl font-bold leading-none">
        {value === NOT_MEASURED ? (
          <span className="text-lg font-medium text-[var(--warn)]">{value}</span>
        ) : (
          value
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--faint)]">{hint}</span>
        {sub}
      </div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`whitespace-nowrap px-3 py-2 font-medium ${right ? "text-right" : ""}`}>
      {children}
    </th>
  );
}
function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`whitespace-nowrap px-3 py-2.5 ${className}`}>{children}</td>;
}
