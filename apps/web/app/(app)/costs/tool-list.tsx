"use client";

import Link from "next/link";

import { useState, useTransition } from "react";
import type { ToolRow } from "@/lib/tools";
import { BILLING_LABEL, TOOL_STATE_LABEL } from "@/lib/tools";
import { decideTool, upsertTool, deleteTool } from "./actions";

const STATE_STYLE: Record<string, string> = {
  active: "bg-[var(--ok)]/12 text-[#1a7a2e]",
  trial: "bg-[var(--accent-weak)] text-[var(--accent)]",
  considering: "bg-[var(--warn)]/15 text-[#9a6a00]",
  stopped: "bg-[var(--panel-2)] text-[var(--faint)]",
};

const yen = (n: number | null) => (n === null ? "—" : `¥${n.toLocaleString("ja-JP")}`);
const jaDate = (d: Date | null) =>
  d ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—";

export function ToolList({ rows }: { rows: ToolRow[] }) {
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold">ツール一覧（{rows.length}件）</h2>
        <button
          onClick={() => setAdding((v) => !v)}
          className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90"
        >
          {adding ? "閉じる" : "ツールを追加"}
        </button>
      </div>

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

      {adding && <ToolForm onDone={(m, ok) => { setToast({ msg: m, ok }); if (ok) setAdding(false); }} />}

      <div className="space-y-2.5">
        {rows.map((t) => (
          <article
            key={t.id}
            className={`rounded-xl border bg-[var(--panel)] p-4 ${
              t.overdue ? "border-[var(--bad)]/40" : "border-[var(--border)]"
            }`}
          >
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${STATE_STYLE[t.state]}`}>
                {TOOL_STATE_LABEL[t.state] ?? t.state}
              </span>
              <strong className="text-[14px]">{t.name}</strong>
              {t.plan && <span className="text-[12px] text-[var(--muted)]">{t.plan}</span>}
              <span className="ml-auto text-[13px] font-medium">
                {t.billingType === "monthly" ? yen(t.monthlyYen) : BILLING_LABEL[t.billingType]}
                {t.billingType === "monthly" && (
                  <span className="text-[11px] text-[var(--faint)]">/月</span>
                )}
              </span>

              {/* 右上の3点メニュー（編集・削除） */}
              <div className="relative">
                <button
                  aria-label="操作"
                  onClick={() => setMenuOpen(menuOpen === t.id ? null : t.id)}
                  className="rounded px-1.5 py-0.5 text-[14px] leading-none text-[var(--muted)] hover:bg-[var(--panel-2)]"
                >
                  ⋯
                </button>
                {menuOpen === t.id && (
                  <div className="absolute right-0 top-6 z-10 w-32 overflow-hidden rounded-md border border-[var(--border-strong)] bg-[var(--panel)] shadow-lg">
                    <button
                      onClick={() => {
                        setEditing(t.id);
                        setMenuOpen(null);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-[12px] hover:bg-[var(--panel-2)]"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => {
                        setConfirmDelete(t.id);
                        setMenuOpen(null);
                      }}
                      className="block w-full px-3 py-1.5 text-left text-[12px] text-[var(--bad)] hover:bg-[var(--panel-2)]"
                    >
                      削除
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* ★削除は確認してから。誤って消すと目的や判定の履歴ごと消える */}
            {confirmDelete === t.id && (
              <div className="mb-2 rounded-md border border-[var(--bad)]/40 bg-[var(--bad)]/[0.06] px-3 py-2 text-[12px]">
                <p className="text-[var(--bad)]">
                  「{t.name}」を削除しますか。目的・期待・判定の記録も消えます。
                  <br />
                  ★<strong>使わなくなっただけなら「編集」で状態を「停止」に</strong>してください。
                  削除すると過去の月額の推移からも消え、実際より安かったことになります。
                </p>
                <div className="mt-1.5 flex gap-2">
                  <button
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        const r = await deleteTool(t.id);
                        setToast(r.ok ? { msg: r.message, ok: true } : { msg: r.error, ok: false });
                        setConfirmDelete(null);
                      })
                    }
                    className="rounded-md bg-[var(--bad)] px-3 py-1 text-[12px] font-medium text-white disabled:opacity-40"
                  >
                    削除する
                  </button>
                  <button
                    onClick={() => setConfirmDelete(null)}
                    className="rounded-md border border-[var(--border-strong)] px-3 py-1 text-[12px]"
                  >
                    やめる
                  </button>
                </div>
              </div>
            )}

            {editing === t.id && (
              <div className="mb-2">
                <ToolForm
                  initial={t}
                  onDone={(m, ok) => {
                    setToast({ msg: m, ok });
                    if (ok) setEditing(null);
                  }}
                />
                <button
                  onClick={() => setEditing(null)}
                  className="text-[12px] text-[var(--muted)] hover:underline"
                >
                  編集をやめる
                </button>
              </div>
            )}

            <p className="text-[12px] leading-relaxed text-[var(--muted)]">
              <strong className="text-[var(--ink)]">目的:</strong> {t.purpose}
            </p>
            {t.expectedOutcome && (
              <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--muted)]">
                <strong className="text-[var(--ink)]">期待:</strong> {t.expectedOutcome}
              </p>
            )}

            {/* ★このツールで何が動いているかを出す。
                止まったときに何が測れなくなるかが分からないと、
                継続/停止の判定ができない（それがこの画面の目的） */}
            {/* ★ジョブが無いツールもある（Cloudflare は配信そのもの）。
                「動いている処理: 」だけ出て中身が空になると、
                直後の注記が処理名に見える。空なら影響範囲を書く */}
            {t.power && t.power.jobs.length > 0 && (
              <p className="mt-1.5 text-[12px] text-[var(--muted)]">
                動いている処理:{" "}
                {t.power.jobs.map((j, i) => (
                  <span key={j.name}>
                    {i > 0 && " / "}
                    <Link href="/jobs" className="hover:text-[var(--accent)] hover:underline">
                      {j.label}
                    </Link>
                  </span>
                ))}
              </p>
            )}
            {t.power && t.power.jobs.length === 0 && (
              <p className="mt-1.5 text-[12px] text-[var(--muted)]">
                止まると: {t.power.losesWhat}
              </p>
            )}

            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--faint)]">
              {t.balance !== null && (
                <span
                  className={
                    t.runsLeft !== null && t.runsLeft < 1
                      ? "font-medium text-[var(--bad)]"
                      : t.balance <= 0.3
                        ? "text-[var(--bad)]"
                        : ""
                  }
                >
                  残高 {t.balance}
                  {t.balanceCurrency ?? ""}
                  {t.balanceCheckedAt && `（${jaDate(t.balanceCheckedAt)}時点）`}
                  {/* ★金額だけでは多いか少ないか分からない。回数に直す */}
                  {t.runsLeft !== null && ` — あと${t.runsLeft}回分`}
                </span>
              )}
              {/* ★残高が取れないものは「0」ではなく「取得できない」と書く（§3） */}
              {t.balance === null && t.billingType === "prepaid" && (
                <span className="text-[var(--warn)]">残高は自動取得できない</span>
              )}
              {t.decideBy && (
                <span className={t.overdue ? "font-medium text-[var(--bad)]" : ""}>
                  判定期日 {jaDate(t.decideBy)}
                  {t.overdue && " — 期限超過"}
                </span>
              )}
              {t.note && <span>{t.note}</span>}
            </div>

            {t.decision ? (
              <p className="mt-2 rounded-md bg-[var(--panel-2)] px-2.5 py-1.5 text-[12px] text-[var(--muted)]">
                <strong>判定（{jaDate(t.decidedAt)}）:</strong> {t.decision}
              </p>
            ) : (
              <div className="mt-2">
                {deciding === t.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="判定の根拠（必須）"
                      className="w-80 rounded-md border border-[var(--border-strong)] bg-[var(--panel)] px-2.5 py-1.5 text-[12px] outline-none focus:border-[var(--accent)]"
                    />
                    {(["active", "stopped"] as const).map((s) => (
                      <button
                        key={s}
                        disabled={pending || !reason.trim()}
                        onClick={() =>
                          start(async () => {
                            const r = await decideTool(t.id, reason, s);
                            setToast(r.ok ? { msg: r.message, ok: true } : { msg: r.error, ok: false });
                            if (r.ok) {
                              setDeciding(null);
                              setReason("");
                            }
                          })
                        }
                        className={`rounded-md px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40 ${
                          s === "active" ? "bg-[var(--accent)]" : "bg-[var(--ink)]"
                        }`}
                      >
                        {s === "active" ? "継続する" : "やめる"}
                      </button>
                    ))}
                    <button
                      onClick={() => setDeciding(null)}
                      className="text-[12px] text-[var(--faint)] underline"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeciding(t.id)}
                    className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[12px] text-[var(--muted)] hover:bg-[var(--panel-2)]"
                  >
                    継続/停止を判定する
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>
    </>
  );
}

/** Date → input[type=date] の値 */
const dateValue = (d: Date | null) =>
  d ? new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10) : "";

function ToolForm({
  onDone,
  initial,
}: {
  onDone: (msg: string, ok: boolean) => void;
  /** 渡すと編集モードになる（未指定なら新規登録） */
  initial?: ToolRow;
}) {
  const [pending, start] = useTransition();
  const [f, setF] = useState({
    name: initial?.name ?? "",
    vendor: initial?.vendor ?? "",
    plan: initial?.plan ?? "",
    billingType: initial?.billingType ?? "monthly",
    monthlyYen: initial?.monthlyYen != null ? String(initial.monthlyYen) : "",
    state: initial?.state ?? "active",
    purpose: initial?.purpose ?? "",
    expectedOutcome: initial?.expectedOutcome ?? "",
    decideBy: dateValue(initial?.decideBy ?? null),
    vendorKey: "",
    note: initial?.note ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF({ ...f, [k]: e.target.value });

  const input = "rounded-md border border-[var(--border-strong)] bg-[var(--panel)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]";

  return (
    <div className="mb-4 rounded-xl border border-[var(--border-strong)] bg-[var(--panel)] p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ツール名（必須）">
          <input value={f.name} onChange={set("name")} className={`w-full ${input}`} placeholder="DataForSEO" />
        </Field>
        <Field label="プラン">
          <input value={f.plan} onChange={set("plan")} className={`w-full ${input}`} placeholder="従量 / スタンダード" />
        </Field>
        <Field label="課金形態">
          <select value={f.billingType} onChange={set("billingType")} className={`w-full ${input}`}>
            <option value="monthly">月額</option>
            <option value="prepaid">前払い/従量</option>
            <option value="free">無料</option>
            <option value="shared">自社既存（追加コストなし）</option>
          </select>
        </Field>
        <Field label="月額（円）">
          <input value={f.monthlyYen} onChange={set("monthlyYen")} className={`w-full ${input}`} placeholder="990" />
        </Field>
        <Field label="状態">
          <select value={f.state} onChange={set("state")} className={`w-full ${input}`}>
            <option value="considering">検討中</option>
            <option value="trial">トライアル</option>
            <option value="active">契約中</option>
            <option value="stopped">停止</option>
          </select>
        </Field>
        <Field label="判定期日">
          <input type="date" value={f.decideBy} onChange={set("decideBy")} className={`w-full ${input}`} />
        </Field>
      </div>

      <div className="mt-3 grid gap-3">
        <Field label="★目的（必須）— 何のために入れたか">
          <input
            value={f.purpose}
            onChange={set("purpose")}
            className={`w-full ${input}`}
            placeholder="競合の検索順位とAI Overviewの有無を取得する"
          />
        </Field>
        <Field label="期待した効果 — 判定の基準になる">
          <input
            value={f.expectedOutcome}
            onChange={set("expectedOutcome")}
            className={`w-full ${input}`}
            placeholder="誰に負けているかが分かり、打ち手が変わる"
          />
        </Field>
        <Field label="残高の自動取得キー（DataForSEO なら dataforseo）">
          <input value={f.vendorKey} onChange={set("vendorKey")} className={`w-full ${input}`} placeholder="dataforseo" />
        </Field>
        <Field label="メモ">
          <input value={f.note} onChange={set("note")} className={`w-full ${input}`} />
        </Field>
      </div>

      <button
        disabled={pending || !f.name.trim() || !f.purpose.trim()}
        onClick={() => start(async () => {
          // ★編集時は id を渡す。渡さないと同名で作れず一意制約に当たる
          const r = await upsertTool(initial ? { ...f, id: initial.id } : f);
          onDone(r.ok ? r.message : r.error, r.ok);
        })}
        className="mt-3 rounded-md bg-[var(--accent)] px-4 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
      >
        {initial ? "更新" : "保存"}
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-[var(--muted)]">{label}</span>
      {children}
    </label>
  );
}
