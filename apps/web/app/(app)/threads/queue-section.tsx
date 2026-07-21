"use client";

// 投稿キューの補充（設計書 §12.3「AIが判断材料を完成させ、押すのは人」）
//
// ★本文は生成しない。ここに並ぶのは、シートに眠っていた
//   「一度も投稿されていない、人が書いた原稿」だけ。
//   システムは YMYL 判定・文字数・フォーマットを揃えて出し、押すのは石井さん。

import { useState, useTransition } from "react";
import type { QueueOverview } from "@/lib/threads-queue";
import { approveQueueDrafts, rejectQueueDraft } from "./queue-actions";

const TARGET_ORDER = ["共通", "法人", "個人事業主"];

export function QueueSection({ data }: { data: QueueOverview }) {
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  const safe = data.candidates.filter((c) => c.ymyl.ok);
  const risky = data.candidates.filter((c) => !c.ymyl.ok);

  const toggle = (row: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(row)) next.delete(row);
      else next.add(row);
      return next;
    });

  const run = (fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setToast({ msg: r.ok ? (r.message ?? "完了") : (r.error ?? "失敗"), ok: r.ok });
      if (r.ok) {
        setPicked(new Set());
        setRejecting(null);
        setReason("");
      }
    });

  // 残数の状態。null は「取れていない」で 0 とは別（§3）
  const stock =
    data.pending === null
      ? { text: "キュー残数を取得できていません", tone: "warn" as const }
      : data.pending === 0
        ? { text: "キューは空です。配信が止まります", tone: "bad" as const }
        : data.pending <= 13
          ? { text: `キュー残り${data.pending}本。明日には止まります`, tone: "bad" as const }
          : data.pending <= 39
            ? { text: `キュー残り${data.pending}本。3日以内に補充が要ります`, tone: "warn" as const }
            : { text: `キュー残り${data.pending}本`, tone: "ok" as const };

  return (
    <div className="mb-5">
      <div className="mb-2 mt-6 flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold">投稿キューの補充</h2>
        {data.candidates.length > 0 && (
          <button
            onClick={() => setOpen((v) => !v)}
            className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
          >
            {open ? "閉じる" : `未投稿の下書き ${data.candidates.length}件を見る`}
          </button>
        )}
      </div>

      {data.error ? (
        <p className="rounded-md bg-[var(--warn)]/12 px-3 py-2 text-[12px] text-[#9a6a00]">
          ★キューの状態を取得できません: {data.error}
        </p>
      ) : (
        <p
          className={`rounded-md px-3 py-2 text-[12px] ${
            stock.tone === "bad"
              ? "bg-[var(--bad)]/10 text-[var(--bad)]"
              : stock.tone === "warn"
                ? "bg-[var(--warn)]/12 text-[#9a6a00]"
                : "bg-[var(--panel)] text-[var(--muted)]"
          }`}
        >
          {stock.text}
          {data.candidates.length > 0 && (
            <>
              {" — "}シートに<strong>一度も投稿していない下書きが {data.candidates.length}件</strong>
              あります（1日13本なので約{Math.floor(data.candidates.length / 13)}日分）。
            </>
          )}
        </p>
      )}

      {toast && (
        <p
          className={`mt-2 rounded-md px-3 py-2 text-[12px] ${
            toast.ok
              ? "bg-[var(--good)]/12 text-[#0a6b3d]"
              : "bg-[var(--bad)]/10 text-[var(--bad)]"
          }`}
        >
          {toast.msg}
        </p>
      )}

      {open && (
        <div className="mt-3 rounded-xl border border-[var(--border-strong)] bg-[var(--panel)] p-3.5">
          <p className="mb-3 text-[12px] leading-relaxed text-[var(--muted)]">
            ★<code>draft</code>（cowork が週次で生成した原稿）と <code>skip</code>
            （過去に配信されずに残った原稿）です。skip は没にしたのか予定時刻を
            過ぎただけなのか、記録からは判別できません。
            <strong>公開は取り消せない</strong>ので、承認は石井さんの操作にしています。
            承認すると実績の多い13枠（07/08/10/11/13/14/15/16/17/18/20/21/22時）に順に割り当てます（過去の時刻には入れません）。
          </p>

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              disabled={pending || picked.size === 0}
              onClick={() => run(() => approveQueueDrafts([...picked]))}
              className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {pending ? "処理中…" : `選んだ ${picked.size}件を公開待ちにする`}
            </button>
            <button
              disabled={pending}
              onClick={() => setPicked(new Set(safe.map((c) => c.rowIndex)))}
              className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[12px] disabled:opacity-40"
            >
              YMYL問題なしの {safe.length}件を全選択
            </button>
            {picked.size > 0 && (
              <button
                onClick={() => setPicked(new Set())}
                className="text-[12px] text-[var(--muted)] underline"
              >
                選択を解除
              </button>
            )}
          </div>

          {risky.length > 0 && (
            <p className="mb-3 rounded-md bg-[var(--bad)]/10 px-3 py-2 text-[12px] text-[var(--bad)]">
              ★{risky.length}件は YMYL 判定または文字数で投稿できません。
              選択できないようにしてあります（本文をシートで直せば次回から選べます）。
            </p>
          )}

          <ul className="flex flex-col gap-2">
            {[...data.candidates]
              .sort(
                (a, b) =>
                  Number(b.ymyl.ok) - Number(a.ymyl.ok) ||
                  TARGET_ORDER.indexOf(a.target) - TARGET_ORDER.indexOf(b.target) ||
                  a.rowIndex - b.rowIndex,
              )
              .map((c) => (
                <li
                  key={c.rowIndex}
                  className={`rounded-lg border p-3 ${
                    c.ymyl.ok
                      ? picked.has(c.rowIndex)
                        ? "border-[var(--ink)] bg-[var(--ink)]/[0.03]"
                        : "border-[var(--border)]"
                      : "border-[var(--bad)]/40 bg-[var(--bad)]/[0.04]"
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      className="mt-1"
                      disabled={!c.ymyl.ok || pending}
                      checked={picked.has(c.rowIndex)}
                      onChange={() => toggle(c.rowIndex)}
                      aria-label={`行${c.rowIndex}を選ぶ`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--muted)]">
                        <span className="rounded bg-[var(--border)]/60 px-1.5 py-0.5">
                          {c.target || "対象なし"}
                        </span>
                        {c.format && (
                          <span className="rounded bg-[var(--border)]/60 px-1.5 py-0.5">
                            {c.format}
                          </span>
                        )}
                        {c.coreMessage && <span>{c.coreMessage}</span>}
                        <span className="tnum">{c.ymyl.length}字</span>
                        <span className="opacity-60">行{c.rowIndex}</span>
                      </div>
                      <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{c.text}</p>
                      {!c.ymyl.ok && (
                        <p className="mt-1.5 text-[12px] font-medium text-[var(--bad)]">
                          投稿不可:{" "}
                          {[...c.ymyl.violations, c.ymyl.tooLong ? "500字超過" : ""]
                            .filter(Boolean)
                            .join(" / ")}
                        </p>
                      )}

                      {rejecting === c.rowIndex ? (
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          <label className="flex min-w-[240px] flex-1 flex-col gap-1">
                            <span className="text-[11px] text-[var(--muted)]">
                              却下理由（必須・次の立案の材料になります）
                            </span>
                            <input
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              placeholder="例: 制度改正で内容が古い"
                              className="rounded-md border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1.5 text-[12px]"
                            />
                          </label>
                          <button
                            disabled={pending || !reason.trim()}
                            onClick={() => run(() => rejectQueueDraft(c.rowIndex, reason))}
                            className="rounded-md bg-[var(--bad)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
                          >
                            却下する
                          </button>
                          <button
                            onClick={() => {
                              setRejecting(null);
                              setReason("");
                            }}
                            className="text-[12px] text-[var(--muted)] underline"
                          >
                            やめる
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setRejecting(c.rowIndex)}
                          className="mt-1.5 text-[12px] text-[var(--muted)] underline"
                        >
                          却下する
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}
