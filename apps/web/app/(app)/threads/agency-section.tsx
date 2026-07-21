"use client";

import { useState, useTransition } from "react";
import type { AgencyData } from "@/lib/agency";
import { STAGE_LABEL, STAGE_ORDER } from "@/lib/agency";
import { addAgencyLead, setAgencyStage } from "./agency-actions";

// 代理店リード（設計書 §3-6・P5.6）。Threads に DM の API が無いため手入力。

const ALL_STAGES = [...STAGE_ORDER, "rejected"];

export function AgencySection({ data }: { data: AgencyData }) {
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [handle, setHandle] = useState("");
  const [postId, setPostId] = useState("");

  const qualified = data.stages.find((s) => s.stage === "qualified")?.count ?? 0;
  const contracted = data.stages.find((s) => s.stage === "contracted")?.count ?? 0;

  return (
    <div className="mb-5">
      <div className="mb-2 mt-6 flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold">代理店DM（{data.total}件）</h2>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
        >
          {open ? "閉じる" : "DMを記録"}
        </button>
      </div>

      {data.unmeasured && (
        <p className="mb-2 rounded-md bg-[var(--warn)]/12 px-3 py-2 text-[12px] text-[#9a6a00]">
          ★代理店募集の投稿はあるのに、DMの記録が1件もありません。これは「DMが
          来ていない」ではなく<strong>「記録していない」</strong>状態です。記録が無いと
          angle別の効果が測れず、代理店投稿を views で評価してしまいます（それは誤りです）。
        </p>
      )}

      {open && (
        <div className="mb-3 rounded-xl border border-[var(--border-strong)] bg-[var(--panel)] p-3.5">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--muted)]">Threadsユーザー名（必須）</span>
              <input
                value={handle}
                onChange={(e) => setHandle(e.target.value)}
                placeholder="@example"
                className="w-48 rounded-md border border-[var(--border-strong)] bg-[var(--panel)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--muted)]">
                きっかけの投稿ID（任意・angle別の効果測定に使う）
              </span>
              <input
                value={postId}
                onChange={(e) => setPostId(e.target.value)}
                placeholder="THR-519"
                className="w-40 rounded-md border border-[var(--border-strong)] bg-[var(--panel)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]"
              />
            </label>
            <button
              disabled={pending || !handle.trim()}
              onClick={() =>
                start(async () => {
                  const r = await addAgencyLead({
                    threadsUserId: handle,
                    sourcePostId: postId || undefined,
                  });
                  setToast(r.ok ? { msg: r.message, ok: true } : { msg: r.error, ok: false });
                  if (r.ok) {
                    setHandle("");
                    setPostId("");
                  }
                })
              }
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
            >
              登録
            </button>
          </div>
        </div>
      )}

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

      {/* 歩留まり */}
      <div className="mb-3 grid gap-3 sm:grid-cols-3">
        <Mini label="DM受信" value={data.total} hint="累計" />
        <Mini
          label="有効化率"
          value={data.total ? `${Math.round((qualified / data.total) * 100)}%` : "—"}
          hint={data.total ? `有効 ${qualified} / 受信 ${data.total}` : "記録がありません"}
        />
        <Mini
          label="契約"
          value={contracted}
          hint={data.total ? `受信 ${data.total} 件からの転換` : "記録がありません"}
        />
      </div>

      {/* angle別 = 代理店投稿の正しい評価軸 */}
      <p className="mb-2 text-[12px] text-[var(--faint)]">
        ★angle別のDM獲得数が代理店投稿の評価軸です。views で優劣を判断しないでください。
      </p>
      <div className="mb-3 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                <th className="whitespace-nowrap px-3 py-2 font-medium">angle</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">投稿数</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">DM</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">1投稿あたり</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">有効</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-medium">契約</th>
              </tr>
            </thead>
            <tbody>
              {data.byAngle.map((a) => (
                <tr key={a.angle} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-3 py-2">{a.angle}</td>
                  <td className="tnum px-3 py-2 text-right">{a.posts}</td>
                  <td className="tnum px-3 py-2 text-right font-medium">{a.leads}</td>
                  <td className="tnum px-3 py-2 text-right text-[var(--muted)]">
                    {a.leadsPerPost === null ? "—" : a.leadsPerPost.toFixed(2)}
                  </td>
                  <td className="tnum px-3 py-2 text-right text-[var(--muted)]">{a.qualified}</td>
                  <td className="tnum px-3 py-2 text-right text-[var(--muted)]">{a.contracted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data.recent.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)]">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-left text-[12px] text-[var(--muted)]">
                  <th className="whitespace-nowrap px-3 py-2 font-medium">ユーザー</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">きっかけ</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">受信</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">段階</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((l) => (
                  <tr key={l.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="whitespace-nowrap px-3 py-2">@{l.threadsUserId}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-[var(--faint)]">
                      {l.sourcePostId ?? "—"}
                      {l.sourceAngle && (
                        <span className="ml-1 text-[var(--muted)]">({l.sourceAngle})</span>
                      )}
                    </td>
                    <td className="tnum whitespace-nowrap px-3 py-2 text-[var(--faint)]">
                      {l.receivedAt.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={l.stage}
                        disabled={pending}
                        onChange={(e) =>
                          start(async () => {
                            const r = await setAgencyStage(l.id, e.target.value);
                            setToast(
                              r.ok ? { msg: r.message, ok: true } : { msg: r.error, ok: false },
                            );
                          })
                        }
                        className="rounded border border-[var(--border-strong)] bg-[var(--panel)] px-1.5 py-1 text-[12px] outline-none focus:border-[var(--accent)]"
                      >
                        {ALL_STAGES.map((s) => (
                          <option key={s} value={s}>
                            {STAGE_LABEL[s] ?? s}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
      <div className="text-[12px] text-[var(--muted)]">{label}</div>
      <div className="tnum mt-1 text-xl font-bold leading-none">{value}</div>
      <div className="mt-1 text-[10px] text-[var(--faint)]">{hint}</div>
    </div>
  );
}
