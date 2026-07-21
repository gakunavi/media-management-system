"use client";

import { useState, useTransition } from "react";
import { runJobNow, toggleJob } from "./actions";

export function JobControls({ jobId, enabled }: { jobId: string; enabled: boolean }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function run() {
    setMsg(null);
    startTransition(async () => {
      const r = await runJobNow(jobId);
      setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    });
  }

  function toggle() {
    setMsg(null);
    startTransition(async () => {
      const r = await toggleJob(jobId, !enabled);
      setMsg(r.ok ? { ok: true, text: r.message } : { ok: false, text: r.error });
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex gap-2">
        <button
          onClick={run}
          disabled={pending}
          className="rounded-md border border-[var(--border-strong)] px-2.5 py-1 text-[12px] text-[var(--muted)] hover:bg-[var(--panel-2)] disabled:opacity-50"
        >
          {pending ? "…" : "今すぐ実行"}
        </button>
        <button
          onClick={toggle}
          disabled={pending}
          className={`rounded-md px-2.5 py-1 text-[12px] font-medium disabled:opacity-50 ${
            enabled
              ? "border border-[var(--border-strong)] text-[var(--muted)] hover:bg-[var(--panel-2)]"
              : "bg-[var(--accent)] text-white"
          }`}
        >
          {enabled ? "停止" : "有効化"}
        </button>
      </div>
      {msg && (
        <span
          className={`max-w-[420px] truncate text-[11px] ${msg.ok ? "text-[#1a7a2e]" : "text-[var(--bad)]"}`}
          title={msg.text}
        >
          {msg.text}
        </span>
      )}
    </div>
  );
}
