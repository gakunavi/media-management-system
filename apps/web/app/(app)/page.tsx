// ダッシュボード（設計書 §4.1）
//
// ★構成の考え方
//   このシステムのゴールは**問い合わせ数を増やすこと**。
//   だから一番上は問い合わせ件数で、PV・クリック・表示はその手前の数字。
//   構造は 2026-07-22 に整理した「送客 → 受け皿 → リード → 成約」に合わせる。
//
// ★タブは3つ。毎日見るもの（結果）と、週に一度でよいもの（経路の計装状況）、
//   壊れていないかの確認（健全性）を同じ密度で並べると、毎日見る数字が埋もれる。
//
// ★期間は画面右上で切り替える。全ての集計に同じ since/until を渡す
//   （旧実装は GSC と GA4 が別々の28日間を合計していた）。
import Link from "next/link";
import { NOT_MEASURED } from "@mms/shared";
import {
  getResult,
  getFunnel,
  getBuyerQuality,
  getJobHealth,
  getSiteTrend,
  getSenderVolumes,
  getMetricFreshness,
  type SiteTrend,
  type FunnelView,
} from "@/lib/dashboard";
import { getAcquisitionMatrix } from "@/lib/acquisition";
import { resolveRange } from "@/lib/period";
import { TrendChart } from "@/components/chart";
import { Stages } from "@/components/stages";
import { RangePicker } from "@/components/range-picker";
import { Tabs, resolveTab } from "@/components/dashboard/tabs";
import { ResultPanel } from "@/components/dashboard/result-panel";
import { HealthPanel, healthAlerts } from "@/components/dashboard/health-panel";
import { RoutesPanel } from "@/components/dashboard/routes-panel";
import { getActionStats, type ActionStats } from "@/lib/actions-repo";

export const dynamic = "force-dynamic";

const jaDate = (d: Date | null) =>
  d
    ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" })
    : "—";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const range = resolveRange(sp);
  const tab = resolveTab(sp.tab);
  // ★期間の指定（プリセット / 任意区間）はタブを移動しても保つ
  const rangeQuery = { range: range.key, from: one(sp.from), to: one(sp.to) };
  const healthHref = `/?${new URLSearchParams(
    Object.entries({ ...rangeQuery, tab: "health" }).filter(([, v]) => v) as [string, string][],
  ).toString()}`;

  // 健全性は「いま」の状態なので期間に依存しない。全タブで警告だけは出す。
  const [health, freshness] = await Promise.all([getJobHealth(), getMetricFreshness()]);
  const alerts = healthAlerts(health, freshness);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">ダッシュボード</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            ゴールは問い合わせ数。{range.label}
            {range.period ? "" : "・暦月と一致しないため月次目標とは比較しない"}
          </p>
        </div>
        <RangePicker range={range} basePath="/" keep={{ tab }} />
      </div>

      {/* ★警告はタブに関係なく常に出す。別タブを開いている間に止まっても気づけるように */}
      {alerts.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {alerts.map((a, i) => (
            <Link
              key={i}
              href={healthHref}
              className="rounded-md bg-[var(--bad)]/10 px-2 py-1 text-[12px] font-medium text-[var(--bad)] hover:bg-[var(--bad)]/[0.16]"
            >
              ● {a}
            </Link>
          ))}
        </div>
      )}

      <Tabs active={tab} query={rangeQuery} />

      {tab === "overview" && <OverviewTab range={range} />}
      {tab === "routes" && <RoutesTab range={range} />}
      {tab === "health" && <HealthPanel health={health} freshness={freshness} />}
    </div>
  );
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/* ─────────────────────────── 結果タブ ─────────────────────────── */

async function OverviewTab({ range }: { range: ReturnType<typeof resolveRange> }) {
  const [result, funnel, trend, buyer, actionStats] = await Promise.all([
    getResult(range),
    getFunnel(range),
    getSiteTrend(range),
    getBuyerQuality(),
    getActionStats(),
  ]);

  return (
    <div className="grid gap-4">
      <ResultPanel result={result} />
      <FunnelPanel funnel={funnel} />
      <TrendPanel trend={trend} />
      <NextActionsPanel stats={actionStats} />
      <BuyerPanel buyer={buyer} />
    </div>
  );
}

/* ─────────────────────────── 経路タブ ─────────────────────────── */

async function RoutesTab({ range }: { range: ReturnType<typeof resolveRange> }) {
  const [volumes, matrix, result] = await Promise.all([
    getSenderVolumes(range),
    getAcquisitionMatrix(range),
    getResult(range),
  ]);
  return (
    <RoutesPanel volumes={volumes} matrix={matrix} result={result} rangeLabel={range.label} />
  );
}

/* ─────────────────────────── 段2 ─────────────────────────── */

/**
 * 記事 → 診断LP の階段。
 *
 * ★各段のデータ源で反映日が違う（GSCは2〜3日遅れ、GA4は翌日）。
 *   どこまでの実測かを書かずに並べると、遅れが「落ち込み」に見える。
 */
function FunnelPanel({ funnel }: { funnel: FunnelView }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
        <span className="inline-flex h-5 items-center rounded-md bg-[var(--ink)] px-1.5 text-[11px] font-semibold text-white">
          段2
        </span>
        <h2 className="text-[15px] font-semibold">記事 → 診断LP の階段</h2>
        <span className="ml-auto text-[11px] text-[var(--faint)]">
          GSC 〜{jaDate(funnel.asOf.gsc)} ／ GA4 〜{jaDate(funnel.asOf.ga4)} の実測
        </span>
      </div>
      <Stages
        stages={funnel.stages}
        transitions={funnel.transitions}
        biggestDropIndex={funnel.biggestDropIndex}
        comparableSegments={funnel.comparableSegments}
      />
      {funnel.unmeasured > 0 && (
        <p className="mt-2 text-[12px] text-[var(--faint)]">
          ★{funnel.unmeasured}段が未計測。記事内のCTA計測タグ（P2.5）が本番未設置のため、
          「記事を読んだ人のうち何人がCTAを見たか」が取れていない。
          他の経路の階段は <Link href="/line" className="text-[var(--accent)] hover:underline">公式LINE</Link>{" "}
          / <Link href="/lp" className="text-[var(--accent)] hover:underline">LP</Link> にあります。
        </p>
      )}
    </section>
  );
}

/* ─────────────────────────── 推移 ─────────────────────────── */

/**
 * 日次推移。
 * ★桁が違う系列を1本の軸に載せない（表示4,556 とクリック154 を同じ軸に置くと
 *   クリックが底に張り付いて増減が読めない）。軸を左右に分ける。
 * ★掲載順位は別パネル。小さいほど良いので上下を反転して描く。
 * ★反映待ち（GSCの2〜3日遅れ）と欠測を分けて書く。毎日「未計測」と出すと、
 *   本物の欠測が埋もれる。
 */
function TrendPanel({ trend }: { trend: SiteTrend }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <h2 className="text-[15px] font-semibold">推移（{trend.days}日）</h2>
      <p className="mb-3 mt-0.5 text-[12px] text-[var(--faint)]">
        {trend.pendingDays > 0 && `末尾${trend.pendingDays}日はデータ反映待ち（GSCは2〜3日遅れが正常）。`}
        {trend.missingDays > 0
          ? `★${trend.missingDays}日は欠測。0として繋がず線を切っている（落ち込みと区別するため）`
          : "欠測なし"}
      </p>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-[var(--border)] p-3.5">
          <div className="mb-1 text-[12px] font-medium text-[var(--muted)]">
            問い合わせ（ゴール）
          </div>
          <TrendChart
            series={[{ label: "問い合わせ", color: "var(--accent)", points: trend.inquiries }]}
            height={140}
          />
        </div>
        <div className="rounded-lg border border-[var(--border)] p-3.5">
          <div className="mb-1 text-[12px] font-medium text-[var(--muted)]">平均掲載順位</div>
          <TrendChart
            series={[
              { label: "平均掲載順位", color: "#b8860b", points: trend.position, invert: true },
            ]}
            height={140}
          />
        </div>
        <div className="rounded-lg border border-[var(--border)] p-3.5 lg:col-span-2">
          <div className="mb-1 text-[12px] font-medium text-[var(--muted)]">
            送客の量（検索の表示・クリックとPV）
          </div>
          <TrendChart
            series={[
              { label: "表示", color: "#8aa0b8", points: trend.impressions },
              { label: "クリック", color: "var(--accent)", points: trend.clicks, axis: "right" },
              { label: "PV（GA4）", color: "#1a7a2e", points: trend.pv, axis: "right" },
            ]}
          />
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────── 段5 ─────────────────────────── */

function NextActionsPanel({ stats }: { stats: ActionStats }) {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="mb-3 flex items-baseline gap-2.5">
        <span className="inline-flex h-5 items-center rounded-md bg-[var(--ink)] px-1.5 text-[11px] font-semibold text-white">
          段5
        </span>
        <h2 className="text-[15px] font-semibold">次の一手</h2>
        <Link
          href="/experiments"
          className="ml-auto text-[12px] text-[var(--accent)] hover:underline"
        >
          施策・PDCA を開く →
        </Link>
      </div>
      {stats.proposed > 0 ? (
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <span className="tnum text-3xl font-bold text-[var(--accent)]">{stats.proposed}</span>
            <span className="ml-1.5 text-[13px] text-[var(--muted)]">件の承認待ち</span>
          </div>
          <Link
            href="/experiments"
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
          >
            承認する
          </Link>
          <span className="text-[12px] text-[var(--faint)]">
            実行中 {stats.approved}・完了 {stats.done}
          </span>
        </div>
      ) : (
        <p className="text-[13px] text-[var(--muted)]">
          承認待ちの提案はありません。
          <Link href="/experiments" className="ml-1 text-[var(--accent)] hover:underline">
            施策・PDCA
          </Link>
          で「立案を実行」すると、実測から改善案を起票します。
        </p>
      )}
    </section>
  );
}

/* ─────────────────────────── 段3 ─────────────────────────── */

function BuyerPanel({ buyer }: { buyer: Awaited<ReturnType<typeof getBuyerQuality>> }) {
  const tagged = buyer.taggedContentRatio;
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
      <div className="mb-2 flex items-baseline gap-2.5">
        <span className="inline-flex h-5 items-center rounded-md bg-[var(--ink)] px-1.5 text-[11px] font-semibold text-white">
          段3
        </span>
        <h2 className="text-[15px] font-semibold">買い手の質</h2>
      </div>
      {tagged && tagged.tagged > 0 ? (
        <p className="text-sm">
          買い手軸タグ付け済み{" "}
          <span className="tnum font-bold">
            {tagged.tagged} / {tagged.total}
          </span>{" "}
          記事
        </p>
      ) : (
        <div>
          <span className="font-medium text-[var(--warn)]">{NOT_MEASURED}</span>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--faint)]">{buyer.note}</p>
        </div>
      )}
    </section>
  );
}
