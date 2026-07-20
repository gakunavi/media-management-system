import Link from "next/link";
import { getContentList, CONTENT_STATUS_LABEL, type ContentRow } from "@/lib/content";

// 記事・投稿一覧（設計書 §4.2 /content・console.html の後継）
export const dynamic = "force-dynamic";

const num = (n: number | null) => (n === null ? "—" : n.toLocaleString("ja-JP"));

function PositionDelta({ delta }: { delta: number | null }) {
  if (delta === null || delta === 0)
    return <span className="text-[var(--faint)]">±0</span>;
  const improved = delta > 0; // 順位が小さくなった＝改善
  return (
    <span className={improved ? "text-[#1a7a2e]" : "text-[var(--bad)]"}>
      {improved ? "▲" : "▼"}
      {Math.abs(delta).toFixed(1)}
    </span>
  );
}

export default async function ContentPage() {
  const rows = await getContentList();
  const measured = rows.filter((r) => r.clicks28 !== null).length;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">記事・投稿</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            全 {rows.length}件（うち実測あり {measured}件）・直近クリック順
          </p>
        </div>
        <div className="text-[12px] text-[var(--faint)]">
          クリック/表示は28日合計・順位は直近7日平均
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                <Th>記事ID</Th>
                <Th>タイトル</Th>
                <Th>状態</Th>
                <Th className="text-right">クリック</Th>
                <Th className="text-right">表示</Th>
                <Th className="text-right">平均順位</Th>
                <Th className="text-right">前週差</Th>
                <Th className="text-right">累計PV</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.id} r={r} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-[12px] text-[var(--faint)]">
        GSC実測は 2026-07-10 で停止中（段7で欠測表示）。日次取得ジョブの登録で再開する。
        <span className="text-[var(--warn)]"> article_unlinked</span> は記事レコードが無いが実測がある URL（§3.2.2）。
      </p>
    </div>
  );
}

function Row({ r }: { r: ContentRow }) {
  return (
    <tr className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--panel-2)]">
      <td className="whitespace-nowrap px-3 py-2.5">
        <Link
          href={`/content/${r.externalId}`}
          className="font-mono text-[12px] text-[var(--accent)] hover:underline"
        >
          {r.externalId}
        </Link>
        {r.type === "article_unlinked" && (
          <span className="ml-1 rounded bg-[var(--warn)]/15 px-1 py-0.5 text-[9px] text-[#9a6a00]">
            未接続
          </span>
        )}
      </td>
      <td className="max-w-[320px] truncate px-3 py-2.5">
        <Link href={`/content/${r.externalId}`} className="hover:underline">
          {r.title}
        </Link>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-[var(--muted)]">
        {CONTENT_STATUS_LABEL[r.status] ?? r.status}
      </td>
      <td className="tnum whitespace-nowrap px-3 py-2.5 text-right font-medium">
        {num(r.clicks28)}
      </td>
      <td className="tnum whitespace-nowrap px-3 py-2.5 text-right text-[var(--muted)]">
        {num(r.impressions28)}
      </td>
      <td className="tnum whitespace-nowrap px-3 py-2.5 text-right">
        {r.avgPosition7 === null ? "—" : r.avgPosition7.toFixed(1)}
      </td>
      <td className="tnum whitespace-nowrap px-3 py-2.5 text-right">
        <PositionDelta delta={r.positionDelta} />
      </td>
      <td className="tnum whitespace-nowrap px-3 py-2.5 text-right text-[var(--muted)]">
        {num(r.pvLifetime)}
      </td>
    </tr>
  );
}

function Th({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <th className={`whitespace-nowrap px-3 py-2 font-medium ${className}`}>{children}</th>;
}
