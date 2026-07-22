import {
  getLeads,
  getLeadStats,
  getOriginBreakdown,
  KIND_TABS,
  resolveKind,
  firstResponseMinutes,
  LEAD_TYPE_LABEL,
  LEAD_STATUS_LABEL,
  BUDGET_TIER_LABEL,
  getSourceBreakdown,
  type SourceBreakdown,
  type SourceRow,
} from "@/lib/leads";
import { LeadForm } from "./lead-form";
import { getAgencyData } from "@/lib/agency";
import { AgencySection } from "./agency-section";
import { resolveRange } from "@/lib/period";
import { RangePicker } from "@/components/range-picker";
import Link from "next/link";

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

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp);
  // ★施策はすべて「見込み客募集」か「代理店募集」のために動いている。
  //   どちらに効いたのかを分けて見ないと施策を評価できない（2026-07-23）
  const kind = resolveKind(sp.kind);
  const [leads, stats, sources, origins, agency] = await Promise.all([
    getLeads(range, kind),
    getLeadStats(range, kind),
    getSourceBreakdown(range, kind),
    getOriginBreakdown(range, kind),
    // ★代理店見込みの選別（stage 遷移）はこのタブで扱う。専用画面は畳んだ
    kind === "agency" ? getAgencyData() : Promise.resolve(null),
  ]);
  const kindHref = (k: string) => {
    const p = new URLSearchParams();
    p.set("range", range.key);
    const from = Array.isArray(sp.from) ? sp.from[0] : sp.from;
    const to = Array.isArray(sp.to) ? sp.to[0] : sp.to;
    if (from) p.set("from", from);
    if (to) p.set("to", to);
    p.set("kind", k);
    return `/leads?${p.toString()}`;
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">リード統計</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            問い合わせ・成約の一覧（{range.label}）。★最優先は直客（§14.0）
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RangePicker range={range} basePath="/leads" keep={{ kind: kind === "all" ? undefined : kind }} />
          <LeadForm />
        </div>
      </div>

      {/* ★種別タブ。施策の評価軸そのもの */}
      <div className="mb-4 flex gap-1 border-b border-[var(--border)]">
        {KIND_TABS.map((t) => (
          <Link
            key={t.key}
            href={kindHref(t.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
              kind === t.key
                ? "border-[var(--accent)] text-[var(--accent)]"
                : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* サマリー */}
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="見込み客" value={stats.byType.direct_inquiry ?? 0} accent />
        <Stat label="代理店見込み" value={stats.byType.agency ?? 0} />
        <Stat label="LINE登録" value={stats.byType.line_friend ?? 0} />
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

      {/* ★代理店見込みタブだけ、選別パイプライン（DM受信→有効→契約）を出す。
          種別ごとに見るべきものが違う（見込み客は商談、代理店は選別と取次） */}
      {agency && <AgencyPipeline data={agency} />}
      <OriginPanel data={origins} />
      <SourcePanel data={sources} />

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
        <br />
        送客 × 受け皿のマトリクス（どのマスが測れていないか）は{" "}
        <Link href="/?tab=routes" className="text-[var(--accent)] hover:underline">
          ダッシュボードの「経路」タブ
        </Link>
        に移しました。
      </p>
    </div>
  );
}

/**
 * 代理店見込みの選別（§3-6・P5.6）。
 *
 * ★もともと /agency という専用画面にあったが、獲得しているものは
 *   「見込み客」と「代理店見込み」の2種類で経路が違うだけなので、
 *   種別タブの中に入れた（2026-07-23 石井さん）。専用画面だと
 *   同じ数字が2箇所に散り、どちらが正か分からなくなる。
 */
function AgencyPipeline({ data }: { data: Awaited<ReturnType<typeof getAgencyData>> }) {
  return (
    <section className="mb-5">
      <h2 className="mb-1 text-[14px] font-semibold">選別パイプライン（現在の状態）</h2>
      <p className="mb-2 text-[12px] text-[var(--faint)]">
        ★期間ではなく<strong>いまの状態</strong>の内訳です（stage は動くため）。
        DMは Threads にしか来ないので、投稿側の効きは{" "}
        <Link href="/threads?tab=posts" className="text-[var(--accent)] hover:underline">
          Threads（投稿の効き）
        </Link>{" "}
        で見ます。
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        {data.stages.map((s) => (
          <div
            key={s.stage}
            className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-[12px] text-[var(--muted)]"
          >
            {s.label} <strong className="tnum ml-1 text-[var(--ink)]">{s.count}</strong>
          </div>
        ))}
      </div>
      <AgencySection data={data} />
    </section>
  );
}

/**
 * きっかけ（施策）別。
 *
 * ★電話・info メールも、きっかけを聞いて記録すればここに乗る。
 *   「いきなり連絡してくる人」はほとんどおらず、何かの施策に触れている。
 * ★「不明」の割合はヒアリングの実行率。ここが高いままだと施策を評価できない。
 */
function OriginPanel({
  data,
}: {
  data: { rows: { key: string; label: string; leads: number; won: number; wonAmount: number }[]; unknownRate: number | null };
}) {
  const total = data.rows.reduce((s, r) => s + r.leads, 0);
  return (
    <section className="mb-5">
      <h2 className="mb-1 text-[14px] font-semibold">きっかけ別（どの施策に触れて来たか）</h2>
      <p className="mb-2 text-[12px] text-[var(--faint)]">
        ★受け皿（どこで受けたか）と直交する軸。電話・info メールも
        <strong>聞いて記録すれば施策の成果として数えられる</strong>。
        {data.unknownRate !== null && data.unknownRate > 0 && (
          <>
            {" "}
            いま <strong className="text-[var(--warn)]">
              {Math.round(data.unknownRate * 100)}%
            </strong>{" "}
            が「不明」＝ヒアリングできていない。
          </>
        )}
      </p>
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                <th className="whitespace-nowrap px-3 py-2 font-medium">きっかけ（施策）</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">リード</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">構成比</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">成約</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">成約金額</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr
                  key={r.key}
                  className={`border-b border-[var(--border)] ${
                    r.key === "unknown" && r.leads > 0 ? "bg-[var(--warn)]/[0.06]" : ""
                  }`}
                >
                  <Td>{r.label}</Td>
                  <Td className="text-right">
                    <span className="tnum font-medium">{r.leads}</span>
                  </Td>
                  <Td className="text-right">
                    <span className="tnum text-[var(--faint)]">
                      {total > 0 ? `${Math.round((r.leads / total) * 100)}%` : "—"}
                    </span>
                  </Td>
                  <Td className="text-right">
                    <span className="tnum">{r.won || "—"}</span>
                  </Td>
                  <Td className="text-right">
                    <span className="tnum">
                      {r.wonAmount > 0 ? `¥${r.wonAmount.toLocaleString("ja-JP")}` : "—"}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
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
        PV・クリック・到達はそのための手前の数字で、ダッシュボードの「経路」タブで見る。
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
            ※MMSが数えるのは Webhook 設置以降・この期間内の登録のみ
          </span>
        </span>
        <span>
          Threads → LINE の送客:{" "}
          <strong className="tnum">{data.threadsToLineClicks}</strong>
          <span className="text-[var(--faint)]"> クリック（{data.days}日・経路の近似）</span>
        </span>
      </div>
    </section>
  );
}
