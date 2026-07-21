"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { approveAction, rejectAction } from "./actions";
import type { ProposedAction } from "@/lib/actions-repo";

const TYPE_LABEL: Record<string, string> = {
  title_meta_rewrite: "タイトル/メタ改善",
  cta_move: "CTA位置変更",
  cta_variant: "CTA文言変更",
  lp_section_edit: "LP改善",
  internal_link: "内部リンク追加",
  new_article: "新規記事",
  kw_pivot: "KW転換",
  threads_format_shift: "Threads型変更",
  stop_low_fit: "低適合の停止",
};

export function ActionCard({ action }: { action: ProposedAction }) {
  const [pending, startTransition] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [done, setDone] = useState(false);

  function onApprove() {
    setMsg(null);
    startTransition(async () => {
      const res = await approveAction(action.id);
      if (res.ok) {
        setMsg({ ok: true, text: res.message });
        setDone(true);
      } else setMsg({ ok: false, text: res.error });
    });
  }

  function onReject() {
    setMsg(null);
    startTransition(async () => {
      const res = await rejectAction(action.id, reason);
      if (res.ok) {
        setMsg({ ok: true, text: res.message });
        setDone(true);
      } else setMsg({ ok: false, text: res.error });
    });
  }

  if (done) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[13px] text-[var(--muted)]">
        {msg?.text}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="rounded bg-[var(--accent-weak)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent)]">
          {TYPE_LABEL[action.type] ?? action.type}
        </span>
        {action.contentExternalId && (
          <Link
            href={`/content/${action.contentExternalId}`}
            className="font-mono text-[12px] text-[var(--accent)] hover:underline"
          >
            {action.contentExternalId}
          </Link>
        )}
        <div className="ml-auto flex items-center gap-1">
          {action.impacts.map((im) => (
            <span
              key={im}
              className="rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]"
            >
              {im}
            </span>
          ))}
        </div>
      </div>

      <div className="text-[13px] font-medium">{action.title}</div>
      <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">{action.rationale}</p>

      {action.evaluateDays && (
        <p className="mt-1.5 text-[11px] text-[var(--faint)]">
          承認すると {action.evaluateDays}日後に効果を自動判定（対照群補正つき・§5.3）
        </p>
      )}

      {msg && !msg.ok && (
        <p className="mt-2 text-[12px] text-[var(--bad)]">{msg.text}</p>
      )}

      {rejecting ? (
        <div className="mt-3 flex items-center gap-2">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="却下理由（学習データになります・§5.6）"
            className="flex-1 rounded-md border border-[var(--border-strong)] bg-[var(--panel)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]"
          />
          <button
            onClick={onReject}
            disabled={pending}
            className="rounded-md bg-[var(--bad)] px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
          >
            却下する
          </button>
          <button
            onClick={() => setRejecting(false)}
            className="rounded-md border border-[var(--border-strong)] px-2.5 py-1.5 text-[13px] text-[var(--muted)]"
          >
            戻る
          </button>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button
            onClick={onApprove}
            disabled={pending}
            className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
          >
            {pending ? "処理中…" : "承認"}
          </button>
          <button
            onClick={() => setRejecting(true)}
            disabled={pending}
            className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[13px] text-[var(--muted)] hover:bg-[var(--panel-2)]"
          >
            却下
          </button>
        </div>
      )}
    </div>
  );
}

export function RunOperatorButton({ onRun }: { onRun: () => Promise<{ ok: boolean; message?: string; error?: string }> }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex items-center gap-3">
      {msg && <span className="text-[12px] text-[var(--muted)]">{msg}</span>}
      <button
        onClick={() =>
          startTransition(async () => {
            const r = await onRun();
            setMsg(r.ok ? (r.message ?? "完了") : (r.error ?? "失敗"));
          })
        }
        disabled={pending}
        className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
      >
        {pending ? "立案中…" : "立案を実行"}
      </button>
    </div>
  );
}
