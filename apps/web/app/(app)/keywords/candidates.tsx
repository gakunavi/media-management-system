"use client";

import { useState, useTransition } from "react";
import type { KeywordCandidate } from "@/lib/keyword-candidates";
import { SERP_USD_PER_KEYWORD_WEEK } from "@/lib/keyword-candidates";
import { trackCandidate } from "./actions";

/**
 * 追跡候補（§3-8）。ラッコの既存エクスポートに埋もれていた未追跡KW。
 * ★自動追加しない。追加するとSERP取得コストが比例して増えるため人が選ぶ。
 */
export function Candidates({ candidates }: { candidates: KeywordCandidate[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());

  if (candidates.length === 0) return null;

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold">
          追跡候補（{candidates.length}件）
        </h2>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:bg-[var(--panel-2)]"
        >
          {open ? "閉じる" : "見る"}
        </button>
      </div>

      {open && (
        <>
          <p className="mb-2 mt-1 text-[12px] text-[var(--faint)]">
            ラッコの既存エクスポートに含まれていた、まだ追跡していないKW（検索数が判明しているもののみ）。
            ★追加すると SERP取得が 1KWあたり約 $
            {(SERP_USD_PER_KEYWORD_WEEK * 52).toFixed(2)}/年 増えます。自動追加はしません。
          </p>

          {toast && (
            <p
              className={`mb-2 rounded-md px-3 py-2 text-[12px] ${
                toast.ok
                  ? "bg-[var(--accent-weak)] text-[var(--accent)]"
                  : "bg-[var(--bad)]/10 text-[var(--bad)]"
              }`}
            >
              {toast.msg}
            </p>
          )}

          <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
            <div className="max-h-[420px] overflow-auto">
              <table className="w-full text-[13px]">
                <thead className="sticky top-0">
                  <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                    <th className="whitespace-nowrap px-3 py-2 font-medium">キーワード</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">検索数</th>
                    <th className="whitespace-nowrap px-3 py-2 text-right font-medium">難易度</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">調査元</th>
                    <th className="whitespace-nowrap px-3 py-2 text-center font-medium">追跡</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.map((c) => (
                    <tr
                      key={c.keyword}
                      className="border-b border-[var(--border)] last:border-0"
                    >
                      <td className="max-w-[300px] truncate px-3 py-2">{c.keyword}</td>
                      <td className="tnum px-3 py-2 text-right font-medium">
                        {c.volume.toLocaleString("ja-JP")}
                      </td>
                      <td className="tnum px-3 py-2 text-right text-[var(--muted)]">
                        {c.difficulty ?? "—"}
                      </td>
                      <td className="max-w-[180px] truncate px-3 py-2 text-[11px] text-[var(--faint)]">
                        {c.from.join(" / ")}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {added.has(c.keyword) ? (
                          <span className="text-[11px] text-[#1a7a2e]">追加済</span>
                        ) : (
                          <button
                            disabled={pending}
                            onClick={() =>
                              start(async () => {
                                const r = await trackCandidate({
                                  keyword: c.keyword,
                                  volume: c.volume,
                                  difficulty: c.difficulty,
                                });
                                setToast(
                                  r.ok
                                    ? { msg: r.message, ok: true }
                                    : { msg: r.error, ok: false },
                                );
                                if (r.ok) setAdded((s) => new Set(s).add(c.keyword));
                              })
                            }
                            className="rounded border border-[var(--border-strong)] px-2 py-0.5 text-[11px] text-[var(--muted)] hover:bg-[var(--panel-2)] disabled:opacity-40"
                          >
                            追跡する
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
