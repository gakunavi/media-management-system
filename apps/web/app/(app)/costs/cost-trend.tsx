"use client";

// 月額の推移（固定＋変動）と、月をクリックしたときの内訳。
//
// ★なぜ固定と変動を分けるか（2026-07-24 石井さん指摘）
//   合計だけ見ると「使っていないのに高い」と「使った結果高い」が区別できない。
//   前者は止めるべきで、後者は成果次第。打ち手が正反対になる。
//
// ★なぜ内訳が要るか
//   「今月 ¥963」と分かっても何に払ったか分からなければ、止める判断ができない。
//   月をクリックしてツール別に開く。
import { useState } from "react";
import type { MonthCost } from "@/lib/tools";

const yen = (n: number) => `¥${Math.round(n).toLocaleString("ja-JP")}`;

export function CostTrend({
  trend,
  potential,
  current,
  usdJpy,
}: {
  trend: MonthCost[];
  potential: number;
  current: number;
  usdJpy: number;
}) {
  const [open, setOpen] = useState<string | null>(trend.at(-1)?.period ?? null);
  const max = Math.max(1, ...trend.map((t) => t.activeYen + t.variableYen), potential);
  const shown = trend.find((t) => t.period === open) ?? null;

  return (
    <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="text-[14px] font-semibold">月額の推移</h2>
        <span className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
          <span className="inline-block h-2 w-3 rounded-sm bg-[var(--accent)]" />
          固定
          <span className="ml-1 inline-block h-2 w-3 rounded-sm bg-[var(--warn)]" />
          変動（使った分）
        </span>
        {potential > current && (
          <span className="ml-auto text-[12px] text-[var(--muted)]">
            検討中を全部契約すると{" "}
            <strong className="tnum text-[var(--warn)]">{yen(potential)}</strong>
          </span>
        )}
      </div>

      {trend.length === 0 ? (
        <p className="mt-2 text-[13px] text-[var(--faint)]">記録はこれから貯まります。</p>
      ) : (
        <>
          <div className="mt-3 flex items-end gap-3">
            {trend.map((t) => {
              const total = t.activeYen + t.variableYen;
              const h = (v: number) => (v <= 0 ? 0 : Math.max(3, (v / max) * 72));
              const selected = t.period === open;
              return (
                <button
                  key={t.period}
                  onClick={() => setOpen(selected ? null : t.period)}
                  className="flex flex-col items-center gap-1"
                  title="クリックで内訳"
                >
                  <span className="tnum text-[11px] text-[var(--muted)]">{yen(total)}</span>
                  <span className="flex w-14 flex-col-reverse overflow-hidden rounded-t">
                    <span
                      className="bg-[var(--accent)]"
                      style={{ height: `${h(t.activeYen)}px` }}
                    />
                    <span
                      className="bg-[var(--warn)]"
                      style={{ height: `${h(t.variableYen)}px` }}
                    />
                  </span>
                  <span
                    className={`text-[11px] ${
                      selected ? "font-medium text-[var(--ink)]" : "text-[var(--faint)]"
                    }`}
                  >
                    {t.period}
                  </span>
                </button>
              );
            })}
          </div>

          {shown && (
            <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3">
              <h3 className="mb-1.5 text-[12px] font-medium">
                {shown.period} の内訳（固定 {yen(shown.activeYen)} ／ 変動{" "}
                {yen(shown.variableYen)}）
              </h3>
              {shown.items.length === 0 ? (
                <p className="text-[12px] text-[var(--faint)]">
                  この月に費用が発生したツールはありません（無料・自社既存のみ）。
                </p>
              ) : (
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-left text-[11px] text-[var(--muted)]">
                      <th className="py-1 pr-2 font-medium">ツール</th>
                      <th className="py-1 pr-2 text-right font-medium">固定</th>
                      <th className="py-1 text-right font-medium">変動（使った分）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.items.map((it) => (
                      <tr key={it.name} className="border-b border-[var(--border)]/60">
                        <td className="py-1 pr-2">
                          {it.name}
                          {it.state !== "active" && (
                            <span className="ml-1 text-[10px] text-[var(--warn)]">（見込み）</span>
                          )}
                        </td>
                        <td className="tnum py-1 pr-2 text-right">
                          {it.fixedYen === null ? "—" : yen(it.fixedYen)}
                        </td>
                        <td className="tnum py-1 text-right">
                          {it.variableYen === null ? (
                            "—"
                          ) : (
                            <>
                              {yen(it.variableYen)}
                              {/* ★原単位を必ず併記。為替は仮定なので後から検証できるようにする */}
                              {it.variableAmount !== null && (
                                <span className="ml-1 text-[10px] text-[var(--faint)]">
                                  ({it.variableAmount.toFixed(4)} {it.variableCurrency})
                                </span>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <p className="mt-2 text-[11px] text-[var(--faint)]">
            ★記録は {trend[0].period} から。それ以前は<strong>未計測</strong>
            （0円ではない）なので描いていません。
            <br />
            ★変動費は<strong>残高の減り</strong>から求めています（前払い/従量には
            「月額」が無いため）。円換算の為替は
            <strong> ¥{usdJpy}/$（設定値・MMS_USD_JPY）</strong>で、
            実際の請求とはズレます。括弧内が実額です。
          </p>
        </>
      )}
    </section>
  );
}
