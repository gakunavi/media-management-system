"use client";

// 実行済みの打ち手と効果判定。
//
// ★なぜ「判定できるか」を判定日より前に出すか
//   判定は「適用後28日 − 適用前28日 − 対照群」で出すが、実測が無ければ
//   何をしても判定不能にしかならない。しかもそれが分かるのは判定日当日で、
//   その時点ではもう打つ手が無い。前もって分かれば、延期するか諦めるかを選べる。
//
// ★判定結果は「ラベル」だけでなく「何がどう変わったか」を出す。
//   「有意差なし」とだけ言われても次の手が決まらない。
import { useState } from "react";
import { useTransition } from "react";
import Link from "next/link";
import type { InterventionRow } from "@/lib/interventions";
import { postpone } from "./actions";

const jaDate = (d: Date | null) =>
  d ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";

const VERDICT: Record<string, { label: string; cls: string }> = {
  pending: { label: "判定待ち", cls: "bg-[var(--panel-2)] text-[var(--muted)]" },
  positive: { label: "効果あり", cls: "bg-[var(--ok)]/12 text-[#1a7a2e]" },
  neutral: { label: "有意差なし", cls: "bg-[var(--panel-2)] text-[var(--muted)]" },
  negative: { label: "悪化", cls: "bg-[var(--bad)]/12 text-[var(--bad)]" },
  inconclusive: { label: "判定不能", cls: "bg-[var(--warn)]/15 text-[#9a6a00]" },
};

export function InterventionTable({ rows }: { rows: InterventionRow[] }) {
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");

  const doomed = rows.filter((r) => r.willBeInconclusive);

  return (
    <section>
      <h2 className="mb-3 text-[15px] font-semibold">
        実行済みの打ち手と効果判定（{rows.length}件）
      </h2>

      {toast && (
        <p
          className={`mb-3 rounded-md px-3 py-2 text-[12px] ${
            toast.ok
              ? "bg-[var(--accent-weak)] text-[var(--accent)]"
              : "bg-[var(--bad)]/10 text-[var(--bad)]"
          }`}
        >
          {toast.msg}
        </p>
      )}

      {/* ★判定日を待たずに「判定できない」と分かるものを先に出す */}
      {doomed.length > 0 && (
        <div className="mb-3 rounded-xl border border-[var(--warn)]/40 bg-[var(--warn)]/[0.08] p-3">
          <p className="text-[13px] font-medium text-[#9a6a00]">
            このままだと判定できない打ち手が {doomed.length}件あります
          </p>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            適用前後どちらかの実測が無いと、判定日が来ても「判定不能」にしかなりません。
            <strong>記事が検索結果に出ていない</strong>か、
            <strong>その期間データが取れていない</strong>かのどちらかです。
            前者は打ち手そのものを見直す、後者は<strong>判定日を延ばす</strong>のが手です。
          </p>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                <th className="px-3 py-2 font-medium">適用日</th>
                <th className="px-3 py-2 font-medium">打ち手</th>
                <th className="px-3 py-2 font-medium">対象</th>
                <th className="px-3 py-2 font-medium">判定日</th>
                <th className="px-3 py-2 font-medium">実測（前 / 後）</th>
                <th className="px-3 py-2 font-medium">判定</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((iv) => {
                const v = VERDICT[iv.verdict] ?? VERDICT.pending;
                return (
                  <>
                    <tr
                      key={iv.id}
                      className={`border-b border-[var(--border)] last:border-0 ${
                        iv.willBeInconclusive ? "bg-[var(--warn)]/[0.05]" : ""
                      }`}
                    >
                      <td className="whitespace-nowrap px-3 py-2.5">{jaDate(iv.appliedAt)}</td>
                      <td className="px-3 py-2.5">{iv.type}</td>
                      <td className="max-w-[16rem] px-3 py-2.5">
                        {iv.contentExternalId ? (
                          <Link
                            href={`/content/${iv.contentExternalId}`}
                            className="hover:text-[var(--accent)] hover:underline"
                          >
                            <span className="font-mono text-[12px]">{iv.contentExternalId}</span>
                            {iv.contentTitle && (
                              <span className="ml-1 block truncate text-[11px] text-[var(--faint)]">
                                {iv.contentTitle}
                              </span>
                            )}
                          </Link>
                        ) : (
                          <span className="text-[var(--warn)]">記事の紐付けなし</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-[var(--muted)]">
                        {jaDate(iv.evaluateAt)}
                        {iv.verdict === "pending" && (
                          <span className="ml-1 text-[11px] text-[var(--faint)]">
                            {iv.daysLeft >= 0 ? `あと${iv.daysLeft}日` : `${-iv.daysLeft}日超過`}
                          </span>
                        )}
                      </td>
                      {/* ★実測の日数を出す。0日は「値が0」ではなく「測れていない」 */}
                      <td className="tnum whitespace-nowrap px-3 py-2.5">
                        <span className={iv.preDays === 0 ? "text-[var(--bad)]" : ""}>
                          {iv.preDays}日
                        </span>
                        {" / "}
                        <span className={iv.postDays === 0 ? "text-[var(--bad)]" : ""}>
                          {iv.postDays}日
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${v.cls}`}>
                          {v.label}
                        </span>
                        {iv.netEffect !== null && (
                          <span
                            className={`tnum ml-1 text-[11px] ${
                              iv.netEffect > 0 ? "text-[#1a7a2e]" : "text-[var(--bad)]"
                            }`}
                          >
                            {iv.netEffect > 0 ? "+" : ""}
                            {iv.netEffect}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {iv.verdict === "pending" && (
                          <button
                            onClick={() => setOpen(open === iv.id ? null : iv.id)}
                            className="text-[11px] text-[var(--accent)] hover:underline"
                          >
                            判定日を延ばす
                          </button>
                        )}
                      </td>
                    </tr>
                    {(iv.reason || iv.postponed.length > 0 || open === iv.id) && (
                      <tr key={`${iv.id}-x`} className="border-b border-[var(--border)]">
                        <td colSpan={7} className="bg-[var(--panel-2)] px-3 py-2">
                          {iv.reason && (
                            <p className="text-[11px] text-[var(--muted)]">理由: {iv.reason}</p>
                          )}
                          {/* ★何回・なぜ延ばしたかを必ず出す。
                              見えないと、都合の悪い判定の先送りに気づけない */}
                          {iv.postponed.map((p, i) => (
                            <p key={i} className="text-[11px] text-[#9a6a00]">
                              延期{iv.postponed.length > 1 ? `${i + 1}回目` : ""}:{" "}
                              {p.from.slice(0, 10)} → {p.to.slice(0, 10)} ／ {p.reason}
                            </p>
                          ))}
                          {open === iv.id && (
                            <div className="mt-1 flex flex-wrap items-end gap-2">
                              <label className="flex flex-col gap-0.5">
                                <span className="text-[10px] text-[var(--muted)]">新しい判定日</span>
                                <input
                                  type="date"
                                  value={date}
                                  onChange={(e) => setDate(e.target.value)}
                                  className="rounded-md border border-[var(--border-strong)] bg-[var(--panel)] px-2 py-1 text-[12px]"
                                />
                              </label>
                              <label className="flex flex-1 flex-col gap-0.5">
                                <span className="text-[10px] text-[var(--muted)]">
                                  理由（必須・なぜ今は判定できないか）
                                </span>
                                <input
                                  value={reason}
                                  onChange={(e) => setReason(e.target.value)}
                                  placeholder="301ループで記事に到達できず実測が取れていなかったため"
                                  className="w-full rounded-md border border-[var(--border-strong)] bg-[var(--panel)] px-2 py-1 text-[12px]"
                                />
                              </label>
                              <button
                                disabled={pending || !date || reason.trim().length < 5}
                                onClick={() =>
                                  start(async () => {
                                    const r = await postpone(iv.id, date, reason);
                                    setToast(
                                      r.ok
                                        ? { msg: r.message, ok: true }
                                        : { msg: r.error, ok: false },
                                    );
                                    if (r.ok) {
                                      setOpen(null);
                                      setDate("");
                                      setReason("");
                                    }
                                  })
                                }
                                className="rounded-md bg-[var(--accent)] px-3 py-1 text-[12px] font-medium text-white disabled:opacity-40"
                              >
                                延ばす
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-[var(--faint)]">
        判定は「適用後28日の実測 − 適用前28日 − 対照群の同期間トレンド」で自動算出（§5.3）。
        毎日 08:00 に判定期日が来たものを処理します。
        <br />
        ★<strong>実測（前 / 後）が 0日</strong>のものは、判定日が来ても
        「判定不能」にしかなりません。<strong>0日は「クリックが0」ではなく「測れていない」</strong>
        という意味です（§3）。
      </p>
    </section>
  );
}
