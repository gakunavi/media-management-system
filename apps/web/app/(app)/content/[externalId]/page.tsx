import Link from "next/link";
import { notFound } from "next/navigation";
import { getContentDetail, CONTENT_STATUS_LABEL } from "@/lib/content";
import { MetricChart } from "./metric-chart";

// 記事詳細（設計書 §3.2.3 記事別の日次推移グラフ）
export const dynamic = "force-dynamic";

const jaDate = (d: Date | null) =>
  d ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";

export default async function ContentDetailPage({
  params,
}: {
  params: Promise<{ externalId: string }>;
}) {
  const { externalId } = await params;
  const item = await getContentDetail(externalId);
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
        {item.url && (
          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-md border border-[var(--border-strong)] px-2.5 py-1 text-[12px] text-[var(--muted)] hover:bg-[var(--panel-2)]"
          >
            記事を開く ↗
          </a>
        )}
      </div>

      {/* メタ */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Meta label="カテゴリ" value={item.category ?? "—"} />
        <Meta label="公開日" value={jaDate(item.publishedAt)} />
        <Meta label="AIO Tier" value={item.aioTier} />
        <Meta
          label="最終実測クリック"
          value={latest?.clicks != null ? String(latest.clicks) : "—"}
        />
      </div>

      {/* グラフ */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="mb-3 text-[15px] font-semibold">指標の推移</h2>
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

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
      <div className="text-[11px] text-[var(--faint)]">{label}</div>
      <div className="mt-0.5 text-[13px] font-medium">{value}</div>
    </div>
  );
}
