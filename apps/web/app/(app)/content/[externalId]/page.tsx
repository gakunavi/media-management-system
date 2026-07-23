import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getContentDetail,
  CONTENT_STATUS_LABEL,
  BUDGET_LABEL,
  FUNNEL_LABEL,
} from "@/lib/content";
import { LEAD_STATUS_LABEL, SOURCE_LABEL } from "@/lib/leads";
import { resolveRange } from "@/lib/period";
import { RangePicker } from "@/components/range-picker";
import { MetricChart } from "./metric-chart";

// 記事詳細（設計書 §3.2.3 記事別の日次推移グラフ）
export const dynamic = "force-dynamic";

const jaDate = (d: Date | null) =>
  d ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";

export default async function ContentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ externalId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { externalId } = await params;
  const range = resolveRange(await searchParams);
  const item = await getContentDetail(externalId, range);
  if (!item) notFound();

  const latest = item.series.at(-1);

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/content" className="text-[12px] text-[var(--accent)] hover:underline">
        ← 記事一覧
      </Link>

      <div className="mb-5 mt-2 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[13px] text-[var(--muted)]">{item.externalId}</span>
            {item.isPillar && (
              <span className="rounded bg-[var(--accent-weak)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent)]">
                ピラー
              </span>
            )}
            <span className="rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
              {CONTENT_STATUS_LABEL[item.status] ?? item.status}
            </span>
          </div>
          <h1 className="mt-1 text-lg font-bold leading-snug">{item.title}</h1>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <RangePicker range={range} basePath={`/content/${item.externalId}`} />
          {item.url && (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-[var(--border-strong)] px-2.5 py-1 text-[12px] text-[var(--muted)] hover:bg-[var(--panel-2)]"
            >
              記事を開く ↗
            </a>
          )}
        </div>
      </div>

      {/* ★ゴール。この記事が初回接点だったリード */}
      <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
        <h2 className="text-[14px] font-semibold">この記事から生まれた問い合わせ</h2>
        {item.leads.length === 0 ? (
          <p className="mt-1 text-[13px] text-[var(--muted)]">
            まだありません。
            <span className="text-[12px] text-[var(--faint)]">
              　★経路が特定できたリードだけが出ます（`firstTouchContentId`）。
              電話・メールは受電時に記事まで聞けないことが多く、その分はここに出ません
            </span>
          </p>
        ) : (
          <ul className="mt-2 grid gap-1 text-[13px]">
            {item.leads.map((l, i) => (
              <li key={i} className="flex items-center gap-3">
                <span className="tnum text-[var(--muted)]">{jaDate(l.occurredAt)}</span>
                <span>{SOURCE_LABEL[l.sourceType] ?? l.sourceType}</span>
                <span className="text-[var(--muted)]">
                  {LEAD_STATUS_LABEL[l.status] ?? l.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* メタ */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Meta label="カテゴリ" value={item.category ?? "—"} />
        <Meta label="公開日" value={jaDate(item.publishedAt)} />
        <Meta label="AIO Tier" value={item.aioTier} />
        <Meta
          label="最終実測クリック"
          value={latest?.clicks != null ? String(latest.clicks) : "—"}
        />
        {/* ★未入力を「—」で流さず、未入力と分かるように出す */}
        <Meta label="買い手軸" value={BUDGET_LABEL[item.budgetTier] ?? item.budgetTier} warn={item.budgetTier === "unknown"} />
        <Meta
          label="ファネル段階"
          value={item.funnelStage ? (FUNNEL_LABEL[item.funnelStage] ?? item.funnelStage) : "未入力"}
          warn={item.funnelStage === null}
        />
        <Meta
          label="鮮度"
          value={item.freshnessTier ?? "未入力"}
          warn={item.freshnessTier === null}
        />
        <Meta label="種別" value={item.type} />
      </div>

      {/* グラフ */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="mb-3 text-[15px] font-semibold">指標の推移（{range.label}）</h2>
        {item.series.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-[var(--faint)]">
            この記事の実測データがありません
          </p>
        ) : (
          <MetricChart series={item.series} />
        )}
      </section>

      {item.note && (
        <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
          <h2 className="mb-2 text-[13px] font-semibold text-[var(--muted)]">メモ</h2>
          <p className="text-[13px] leading-relaxed">{item.note}</p>
        </section>
      )}
    </div>
  );
}

function Meta({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
      <div className="text-[11px] text-[var(--faint)]">{label}</div>
      <div className={`mt-0.5 text-[13px] font-medium ${warn ? "text-[var(--warn)]" : ""}`}>
        {value}
      </div>
    </div>
  );
}
