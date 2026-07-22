import Link from "next/link";
import { notFound } from "next/navigation";
import { NOT_MEASURED } from "@mms/shared";
import {
  getLpDetail,
  LP_TYPE_LABEL,
  LP_STATUS_LABEL,
  CODE_IDLE_DAYS,
  type LpDetail,
} from "@/lib/lp-registry";
import { resolveRange } from "@/lib/period";
import { RangePicker } from "@/components/range-picker";
import { Stages } from "@/components/stages";
import { TrendChart } from "@/components/chart";
import { LpForm } from "../lp-form";

// LP個別（設計書 §3.8.6）
//
// ★どのLPも同じ読み方にする。到達 → CTA → 問い合わせ → リード → 成約。
//   LPごとに読み方が変わると、比較も判断もできない。
//
// ★A/Bは「1つのLPのバリアント」。勝敗は母数が足りてから言う（§16.5）。
// ★代理店コードを配るLPだけ、配布コード別の稼働を出す。
export const dynamic = "force-dynamic";

const jaDate = (d: Date) =>
  d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" });
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);

export default async function LpDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const range = resolveRange(await searchParams);
  const d = await getLpDetail(slug, range);
  if (!d) notFound();

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/lp" className="text-[12px] text-[var(--accent)] hover:underline">
            ← LP一覧
          </Link>
          <h1 className="mt-0.5 text-xl font-bold tracking-tight">{d.row.name}</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            {LP_TYPE_LABEL[d.row.lpType] ?? d.row.lpType}・
            {LP_STATUS_LABEL[d.row.status] ?? d.row.status}・オファー: {d.row.offer}・
            {range.label}
            <br />
            <a
              href={d.row.url}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] hover:underline"
            >
              {d.row.url}
            </a>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RangePicker range={range} basePath={`/lp/${slug}`} />
          <LpForm initial={d.row.registry} />
        </div>
      </div>

      {d.row.note && (
        <p className="mb-4 rounded-md bg-[var(--warn)]/12 px-3 py-2 text-[12px] text-[#9a6a00]">
          ★{d.row.note}
        </p>
      )}

      {/* ── 階段 ── */}
      <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="mb-2 text-[15px] font-semibold">どこで落ちているか</h2>
        <Stages
          stages={d.flow.stages}
          transitions={d.flow.transitions}
          biggestDropIndex={d.flow.biggestDropIndex}
          comparableSegments={d.flow.comparableSegments}
        />
      </section>

      {/* ── A/B ── */}
      {d.variants.length > 0 && (
        <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <h2 className="text-[15px] font-semibold">A/Bテスト（{d.variants.length}パターン）</h2>
          <p className="mb-3 mt-0.5 text-[12px] text-[var(--faint)]">{d.verdict}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[11px] text-[var(--muted)]">
                  <th className="py-1.5 pr-2 font-medium">パターン</th>
                  <th className="py-1.5 pr-2 text-right font-medium">到達（実人数）</th>
                  <th className="py-1.5 pr-2 text-right font-medium">表示</th>
                  <th className="py-1.5 pr-2 text-right font-medium">問い合わせ</th>
                  <th className="py-1.5 text-right font-medium">CVR</th>
                </tr>
              </thead>
              <tbody>
                {d.variants.map((v) => (
                  <tr key={v.key} className="border-b border-[var(--border)]/60">
                    <td className="py-1.5 pr-2 font-medium">{v.label}</td>
                    <td className="tnum py-1.5 pr-2 text-right">{v.users}</td>
                    <td className="tnum py-1.5 pr-2 text-right text-[var(--muted)]">{v.views}</td>
                    <td className="tnum py-1.5 pr-2 text-right">
                      {v.submits === null ? (
                        <span className="text-[11px] text-[var(--warn)]">{NOT_MEASURED}</span>
                      ) : (
                        v.submits
                      )}
                    </td>
                    <td className="tnum py-1.5 text-right">{pct(v.cvr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ── 代理店コード ── */}
      {d.row.hasAgencyCodes && <CodePanel d={d} />}

      {/* ── 推移 ── */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="mb-2 text-[15px] font-semibold">到達の推移（{d.days}日）</h2>
        <TrendChart
          series={[{ label: "到達", color: "var(--accent)", points: d.trend }]}
          height={160}
        />
      </section>
    </div>
  );
}

/**
 * 配布コード別の稼働。
 *
 * ★このLPに紐づく属性なので、代理店の画面ではなくLPの画面に置く（2026-07-23）。
 * ★見たいのは「配ったコードが動いているか」。訪問が多い順ではなく、
 *   止まっているものが埋もれない並びにする。
 */
function CodePanel({ d }: { d: LpDetail }) {
  const idle = d.codes.filter((c) => c.idleDays >= CODE_IDLE_DAYS);
  return (
    <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <h2 className="text-[15px] font-semibold">配布コード別（代理店が動いているか）</h2>
      <p className="mb-3 mt-0.5 text-[12px] text-[var(--faint)]">
        {d.uncodedRate !== null && (
          <>
            訪問の <strong className="text-[var(--warn)]">{Math.round(d.uncodedRate * 100)}%</strong>{" "}
            がコード無し（どの代理店の貢献か識別できていない）。
            コードは sessionStorage 保持のため、タブを閉じると消える。
            <br />
          </>
        )}
        {idle.length > 0 && (
          <>
            配布済み {d.codes.length}件のうち{" "}
            <strong className="text-[var(--bad)]">{idle.length}件</strong> が{CODE_IDLE_DAYS}
            日以上流入なし（配ったが動いていない）。
          </>
        )}
      </p>
      {d.codes.length === 0 ? (
        <p className="text-[13px] text-[var(--muted)]">
          この期間にコード付きの訪問がありません。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[11px] text-[var(--muted)]">
                <th className="py-1.5 pr-2 font-medium">コード</th>
                <th className="py-1.5 pr-2 text-right font-medium">訪問</th>
                <th className="py-1.5 pr-2 text-right font-medium">問い合わせ</th>
                <th className="py-1.5 pr-2 text-right font-medium">最終流入</th>
                <th className="py-1.5 font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {d.codes.map((c) => (
                <tr key={c.code} className="border-b border-[var(--border)]/60">
                  <td className="py-1.5 pr-2 font-mono text-[12px]">{c.code}</td>
                  <td className="tnum py-1.5 pr-2 text-right font-medium">{c.visits}</td>
                  <td className="tnum py-1.5 pr-2 text-right">{c.inquiries || "—"}</td>
                  <td className="tnum py-1.5 pr-2 text-right text-[var(--faint)]">
                    {jaDate(c.lastAt)}
                  </td>
                  <td className="py-1.5 text-[11px]">
                    {c.idleDays >= CODE_IDLE_DAYS ? (
                      <span className="text-[var(--bad)]">{c.idleDays}日 停止</span>
                    ) : (
                      <span className="text-[#1a7a2e]">稼働中</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
