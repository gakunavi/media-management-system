"use client";

import { useState, useTransition } from "react";
import { runIdeaCollection } from "./actions";

export function RunIdeas() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  return (
    <div className="flex items-center gap-2">
      {msg && (
        <span
          className={`text-[12px] ${msg.ok ? "text-[var(--accent)]" : "text-[var(--bad)]"}`}
        >
          {msg.text}
        </span>
      )}
      <button
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await runIdeaCollection();
            setMsg(r.ok ? { text: r.message, ok: true } : { text: r.error, ok: false });
          })
        }
        className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "収集中…" : "ネタを収集"}
      </button>
    </div>
  );
}
