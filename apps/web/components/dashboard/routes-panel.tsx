// 経路タブ: 送客 × 受け皿
//
// ★リードの増減だけ見ても、原因が「送客が減った」のか「受け皿が壊れた」のか
//   分からない。同じ期間で、送客側の量と受け皿側の結果を並べる。
//
// ★マトリクスの目的は数字を見ることではなく、**どのマスが測れていないか**を
//   出すこと。空欄を 0 で埋めると「送客していない」と「測っていない」が
//   区別できなくなる（§3）。未計測（直せる）と測定不能（直せない）も分ける。
import Link from "next/link";
import { NOT_MEASURED } from "@mms/shared";
import { SENDERS, RECEIVERS, type AcquisitionMatrix } from "@/lib/acquisition";
import type { SenderVolume, ResultView } from "@/lib/dashboard";

function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}

export function RoutesPanel({
  volumes,
  matrix,
  result,
  rangeLabel,
}: {
  volumes: SenderVolume[];
  matrix: AcquisitionMatrix;
  result: ResultView;
  rangeLabel: string;
}) {
  const unmeasuredReceivers = result.receivers.filter((r) => !r.measured);

  return (
    <div className="grid gap-5">
      {/* ── 送客側 ── */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="text-[15px] font-semibold">送客（どれだけ人を送り出したか）</h2>
        <p className="mb-3 mt-0.5 text-[12px] text-[var(--faint)]">
          {rangeLabel}・単位が違うので経路どうしを足さない
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] text-left text-[11px] text-[var(--muted)]">
                <th className="py-1.5 pr-2 font-medium">送客元</th>
                <th className="py-1.5 pr-2 text-right font-medium">送り出し</th>
                <th className="py-1.5 pr-2 text-right font-medium">受け皿への到達</th>
                <th className="py-1.5 font-medium">状態</th>
              </tr>
            </thead>
            <tbody>
              {volumes.map((v) => (
                <tr key={v.key} className="border-b border-[var(--border)]/60">
                  <td className="py-1.5 pr-2">
                    <Link href={v.detailHref} className="text-[var(--accent)] hover:underline">
                      {v.label}
                    </Link>
                  </td>
                  <td className="tnum py-1.5 pr-2 text-right font-medium">
                    {v.value === null ? (
                      <span className="text-[11px] font-medium text-[var(--warn)]">
                        {NOT_MEASURED}
                      </span>
                    ) : (
                      <>
                        {v.value.toLocaleString("ja-JP")}
                        <span className="ml-1 text-[11px] font-normal text-[var(--faint)]">
                          {v.unit}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="tnum py-1.5 pr-2 text-right">
                    {v.arrived === null ? (
                      <span className="text-[11px] text-[var(--warn)]">{NOT_MEASURED}</span>
                    ) : (
                      <>
                        {v.arrived.toLocaleString("ja-JP")}
                        <span className="ml-1 text-[11px] text-[var(--faint)]">
                          {v.arrivedLabel}
                        </span>
                      </>
                    )}
                  </td>
                  <td className="py-1.5 text-[11px] text-[var(--faint)]">{v.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── マトリクス ── */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="text-[15px] font-semibold">送客 × 受け皿（計測できているマス）</h2>
        <p className="mb-3 mt-0.5 text-[12px] text-[var(--faint)]">
          計測できているマス <strong className="tnum">{matrix.coverage.measured}</strong> /{" "}
          {matrix.coverage.target}（測定不能なマスは分母から除外）。
          <strong>未計測は直せるが、測定不能は直せない</strong>ので分けて出す。
        </p>
        <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
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
                    const c = matrix.cells.find((x) => x.sender === s.key && x.receiver === r.key);
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
                    <span className="tnum">{matrix.receiverTotals[r.key] ?? 0}</span>
                  </Td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] text-[var(--faint)]">
          ★上段は「送った数（クリック・到達）」、最下段は「着地したリード数」。単位が違うので
          縦に足し引きしないこと。マスにカーソルを合わせると理由が出ます。
        </p>
      </section>

      {/* ── 次に計装すべき箇所 ── */}
      <section className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5">
        <h2 className="text-[15px] font-semibold">次に計装すべき受け皿</h2>
        {unmeasuredReceivers.length === 0 ? (
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            すべての受け皿が計測中です。
          </p>
        ) : (
          <ul className="mt-2 grid gap-1.5 text-[13px]">
            {unmeasuredReceivers.map((r) => (
              <li key={r.key} className="flex items-baseline gap-2">
                <span className="text-[var(--warn)]">●</span>
                <span className="font-medium">{r.label}</span>
                <span className="text-[12px] text-[var(--faint)]">
                  受信しても記録されないため、件数を 0 と読んではいけない
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
          {[
            { href: "/threads", label: "Threads・代理店" },
            { href: "/line", label: "公式LINE" },
            { href: "/lp", label: "LP" },
            { href: "/content", label: "記事・投稿" },
            { href: "/leads", label: "リード一覧" },
          ].map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-md border border-[var(--border-strong)] px-2 py-1 text-[var(--muted)] hover:bg-[var(--panel-2)]"
            >
              {l.label} →
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
