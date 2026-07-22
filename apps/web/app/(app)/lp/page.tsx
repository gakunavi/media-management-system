import Link from "next/link";
import { NOT_MEASURED } from "@mms/shared";
import { getLpList, LP_TYPE_LABEL, LP_STATUS_LABEL, type LpRow } from "@/lib/lp-registry";
import { resolveRange } from "@/lib/period";
import { RangePicker } from "@/components/range-picker";

// LP台帳（設計書 §3.8.6・PRJ-034）
//
// ★LPは今後増える（商材別・総合窓口・代理店募集…）。旧実装は「診断LP」と
//   「代理店LP」を画面に直書きしていたため、3本目で破綻する作りだった。
//   台帳（LandingPage）から引き、どのLPも同じ読み方にする。
//
// ★LPは獲得の受け皿。だからメニューは「獲得」に置く。管理メニューに分けると
//   「LPの数字」と「獲得の数字」が別の場所になり、判断が2箇所に割れる。
export const dynamic = "force-dynamic";

const jaDate = (d: Date | null) =>
  d
    ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" })
    : "—";
const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const yen = (v: number) => (v > 0 ? `¥${v.toLocaleString("ja-JP")}` : "—");

export default async function LpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const range = resolveRange(await searchParams);
  const rows = await getLpList(range);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">LP</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            {range.label}・LPは全て「問い合わせを取る受け皿」。種別が違っても読み方は同じ
          </p>
        </div>
        <RangePicker range={range} basePath="/lp" />
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                <Th>LP</Th>
                <Th>種別</Th>
                <Th>状態</Th>
                <Th right>到達</Th>
                <Th right>問い合わせ</Th>
                <Th right>CVR</Th>
                <Th right>リード</Th>
                <Th right>成約</Th>
                <Th right>金額</Th>
                <Th>A/B</Th>
                <Th right>最終データ</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.slug} className="border-b border-[var(--border)] last:border-0">
                  <Td>
                    <Link
                      href={`/lp/${r.slug}`}
                      className="font-medium text-[var(--accent)] hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.hasAgencyCodes && (
                      <span className="ml-1 rounded bg-[var(--panel-2)] px-1 py-0.5 text-[10px] text-[var(--faint)]">
                        代理店コード
                      </span>
                    )}
                    {r.note && (
                      <div className="mt-0.5 text-[11px] text-[var(--warn)]">★{r.note}</div>
                    )}
                  </Td>
                  <Td className="text-[var(--muted)]">{LP_TYPE_LABEL[r.lpType] ?? r.lpType}</Td>
                  <Td className="text-[var(--muted)]">{LP_STATUS_LABEL[r.status] ?? r.status}</Td>
                  <Num v={r.reach} />
                  <Num v={r.inquiries} />
                  <Td className="tnum text-right">{pct(r.cvr)}</Td>
                  <Td className="tnum text-right">{r.leads || "—"}</Td>
                  <Td className="tnum text-right">{r.won || "—"}</Td>
                  <Td className="tnum text-right">{yen(r.wonAmount)}</Td>
                  <Td className="text-[var(--muted)]">
                    {r.variantCount > 0 ? `${r.variantCount}パターン` : "—"}
                  </Td>
                  <Td className="tnum text-right text-[var(--faint)]">{jaDate(r.lastDataAt)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-[12px] text-[var(--faint)]">
        ★「—(未計測)」は 0件ではなく<strong>記録される仕組みが無い</strong>状態（§3）。
        CVRは到達・問い合わせの<strong>両方が実測のときだけ</strong>出します（片方が未計測のまま
        率を出すと、壊れた計測が「成果ゼロ」に化けるため）。
        <br />
        LPを追加するときは台帳（LandingPage）に登録します。種別は{" "}
        {Object.values(LP_TYPE_LABEL).join(" / ")} から選び、代理店コードを配るLPは
        「代理店コード」を有効にすると、配布コード別の稼働が個別画面に出ます。
      </p>
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
  return <td className={`px-3 py-2.5 ${className}`}>{children}</td>;
}
function Num({ v }: { v: LpRow["reach"] }) {
  return (
    <Td className="tnum text-right font-medium">
      {v === null ? (
        <span className="text-[11px] font-medium text-[var(--warn)]">{NOT_MEASURED}</span>
      ) : (
        v.toLocaleString("ja-JP")
      )}
    </Td>
  );
}
