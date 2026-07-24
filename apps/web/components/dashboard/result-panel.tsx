// 段1: 結果（問い合わせ）
//
// ★このシステムのゴールは問い合わせ数を増やすこと。だから一番大きい数字は
//   問い合わせ件数。PV・クリック・登録はその手前の数字で、下に置く。
//
// ★LINE登録を問い合わせに合算しない。登録は受け皿への到達であって相談ではない。
//   混ぜると「ゴールに近づいた」ように見えるが、商談は増えていない。
//
// ★受け皿ごとに出す。増やす打ち手は受け皿ごとに違う（LPの改修と
//   Threads DM の返信テンプレは別の仕事）。合算だけでは何を直すか決まらない。
import Link from "next/link";
import { NOT_MEASURED } from "@mms/shared";
import type { ResultView } from "@/lib/dashboard";

const yen = (n: number) => `¥${n.toLocaleString("ja-JP")}`;

/** 前期間との差。0 は「±0」と出す（変化なしと未計測は別） */
function Delta({ now, prev }: { now: number | null; prev: number | null }) {
  if (now === null || prev === null) {
    return <span className="text-[11px] text-[var(--faint)]">前期間比 —</span>;
  }
  const d = now - prev;
  const cls = d > 0 ? "text-[#1a7a2e]" : d < 0 ? "text-[var(--bad)]" : "text-[var(--faint)]";
  return (
    <span className={`tnum text-[11px] ${cls}`}>
      前期間比 {d > 0 ? `+${d}` : d === 0 ? "±0" : d}
    </span>
  );
}

function Card({
  label,
  value,
  sub,
  delta,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  delta?: React.ReactNode;
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
      <div className="mt-1.5 flex items-baseline gap-1.5">{value}</div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] text-[var(--faint)]">{sub}</span>
        {delta}
      </div>
    </div>
  );
}

export function ResultPanel({ result }: { result: ResultView }) {
  const { inquiries, registrations, won, receivers, byType, targetComparable } = result;
  const pct =
    inquiries.target && inquiries.target > 0
      ? Math.min(100, Math.round((inquiries.value / inquiries.target) * 100))
      : null;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)]">
      <div className="mb-4 flex items-baseline gap-2.5">
        <span className="inline-flex h-5 items-center rounded-md bg-[var(--ink)] px-1.5 text-[11px] font-semibold text-white">
          段1
        </span>
        <h2 className="text-[15px] font-semibold">結果（問い合わせ）</h2>
        <Link href="/leads" className="ml-auto text-[12px] text-[var(--accent)] hover:underline">
          リード統計 →
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card
          accent
          label="問い合わせ（ゴール）"
          value={
            <>
              <span className="tnum text-3xl font-bold leading-none">{inquiries.value}</span>
              <span className="tnum text-[13px] text-[var(--faint)]">
                {inquiries.target !== null ? `/ ${inquiries.target}件` : "件"}
              </span>
            </>
          }
          sub={
            inquiries.target !== null
              ? `目標の${pct}%`
              : targetComparable
                ? "目標未設定（Target: inquiries_total）"
                : "暦月と一致しない期間のため目標比較なし"
          }
          delta={<Delta now={inquiries.value} prev={inquiries.prev} />}
        />
        <Card
          label="成約"
          value={
            <>
              <span className="tnum text-3xl font-bold leading-none">{won.count}</span>
              <span className="text-[13px] text-[var(--faint)]">件</span>
            </>
          }
          sub={won.amount > 0 ? yen(won.amount) : "金額未入力"}
          delta={<Delta now={won.count} prev={won.prevCount} />}
        />
        {/* ★総数ではなく「期間内の増減」を出す（§4-99）。
            友だち総数には公式LINEの計測を始める前の人も含まれ、その人たちは
            どこから登録したか分からない。同じ数字として並べると誤読される。 */}
        <Card
          label="LINE友だちの増減（問い合わせの手前）"
          value={
            registrations.value === null ? (
              <span className="font-medium text-[var(--warn)]">{NOT_MEASURED}</span>
            ) : (
              <>
                <span className="tnum text-3xl font-bold leading-none">
                  {registrations.value > 0 ? `+${registrations.value}` : registrations.value}
                </span>
                <span className="text-[13px] text-[var(--faint)]">人</span>
              </>
            )
          }
          sub={
            registrations.total === null
              ? "登録は相談ではないので問い合わせに合算しない"
              : `いま合計 ${registrations.total} 人 ／ 登録は相談ではないので問い合わせに合算しない`
          }
          delta={<Delta now={registrations.value} prev={registrations.prev} />}
        />
      </div>

      {/* ── 受け皿別 ── */}
      <h3 className="mb-2 mt-5 text-[13px] font-semibold">受け皿別（どこで受けたか）</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-[11px] text-[var(--muted)]">
              <th className="py-1.5 pr-2 font-medium">受け皿</th>
              <th className="py-1.5 pr-2 text-right font-medium">問い合わせ</th>
              <th className="py-1.5 pr-2 text-right font-medium">前期間</th>
              <th className="py-1.5 pr-2 text-right font-medium">登録</th>
              <th className="py-1.5 pr-2 text-right font-medium">成約</th>
              <th className="py-1.5 pr-2 text-right font-medium">金額</th>
              <th className="py-1.5 font-medium">計測</th>
            </tr>
          </thead>
          <tbody>
            {receivers.map((r) => (
              <tr key={r.key} className="border-b border-[var(--border)]/60">
                <td className="py-1.5 pr-2">{r.label}</td>
                <td className="tnum py-1.5 pr-2 text-right font-medium">
                  {r.inquiries === null ? (
                    <span className="text-[11px] font-medium text-[var(--warn)]">
                      {NOT_MEASURED}
                    </span>
                  ) : (
                    r.inquiries
                  )}
                </td>
                <td className="tnum py-1.5 pr-2 text-right text-[var(--faint)]">
                  {r.prevInquiries === null ? "—" : r.prevInquiries}
                </td>
                <td className="tnum py-1.5 pr-2 text-right text-[var(--muted)]">
                  {r.registrations === null ? "—" : r.registrations}
                </td>
                <td className="tnum py-1.5 pr-2 text-right">{r.won || "—"}</td>
                <td className="tnum py-1.5 pr-2 text-right">
                  {r.wonAmount > 0 ? yen(r.wonAmount) : "—"}
                </td>
                <td className="py-1.5 text-[11px]">
                  {r.measured ? (
                    <span className="text-[#1a7a2e]">計測中</span>
                  ) : (
                    <span className="text-[var(--warn)]">未計測</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[12px] text-[var(--faint)]">
        問い合わせ列の合計が上の「問い合わせ（ゴール）」と一致します（登録列は含みません）。
        「未計測」は 0件ではなく<strong>記録される仕組みが無い</strong>状態（§3）。
        埋め方は「経路」タブに出しています。 種別内訳:{" "}
        {byType
          .map((t) => `${t.label} ${t.value}件${t.target !== null ? `（目標${t.target}件）` : ""}`)
          .join(" ・ ")}
      </p>
    </section>
  );
}
