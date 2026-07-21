"use client";

import { useState, useTransition } from "react";
import type { IdeaRow } from "@/lib/ideas";
import { IDEA_SOURCE_LABEL } from "@/lib/ideas";
import { adoptIdea, dismissIdea } from "./idea-actions";

const SOURCE_STYLE: Record<string, string> = {
  threads_hit: "bg-[var(--accent-weak)] text-[var(--accent)]",
  aio_miss: "bg-[var(--warn)]/15 text-[#9a6a00]",
};

const STATE_LABEL: Record<string, string> = {
  new: "未対応",
  adopted: "記事化を起票済",
  dismissed: "見送り",
};

export function IdeaCard({ idea }: { idea: IdeaRow }) {
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState("");

  const isNew = idea.state === "new";

  return (
    <article className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span
          className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
            SOURCE_STYLE[idea.source] ?? "bg-[var(--panel-2)] text-[var(--faint)]"
          }`}
        >
          {IDEA_SOURCE_LABEL[idea.source] ?? idea.source}
        </span>
        {idea.impacts.map((m) => (
          <span
            key={m}
            className="rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]"
          >
            {m}
          </span>
        ))}
        {!isNew && (
          <span
            className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
              idea.state === "adopted"
                ? "bg-[var(--ok)]/12 text-[#1a7a2e]"
                : "bg-[var(--panel-2)] text-[var(--faint)]"
            }`}
          >
            {STATE_LABEL[idea.state] ?? idea.state}
          </span>
        )}
        <span className="ml-auto text-[11px] text-[var(--faint)]">
          {idea.createdAt.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}
        </span>
      </div>

      <h2 className="text-[14px] font-semibold">{idea.title}</h2>
      {idea.body && (
        <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">{idea.body}</p>
      )}

      {toast && (
        <p
          className={`mt-2 rounded-md px-2.5 py-1.5 text-[12px] ${
            toast.ok
              ? "bg-[var(--accent-weak)] text-[var(--accent)]"
              : "bg-[var(--bad)]/10 text-[var(--bad)]"
          }`}
        >
          {toast.msg}
        </p>
      )}

      {isNew && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await adoptIdea(idea.id);
                setToast(r.ok ? { msg: r.message, ok: true } : { msg: r.error, ok: false });
              })
            }
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
          >
            記事化する
          </button>
          {!dismissing ? (
            <button
              disabled={pending}
              onClick={() => setDismissing(true)}
              className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:bg-[var(--panel-2)] disabled:opacity-40"
            >
              見送る
            </button>
          ) : (
            <>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="見送り理由（必須・次の供給の見直しに使う）"
                className="w-72 rounded-md border border-[var(--border-strong)] bg-[var(--panel)] px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--accent)]"
              />
              <button
                disabled={pending || !reason.trim()}
                onClick={() =>
                  start(async () => {
                    const r = await dismissIdea(idea.id, reason);
                    setToast(r.ok ? { msg: r.message, ok: true } : { msg: r.error, ok: false });
                    if (r.ok) setDismissing(false);
                  })
                }
                className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
              >
                確定
              </button>
            </>
          )}
          <span className="text-[11px] text-[var(--faint)]">
            記事化すると「施策・PDCA」に次の一手として並びます（承認は別途）
          </span>
        </div>
      )}
    </article>
  );
}
