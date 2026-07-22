"use client";

// 自分で行った施策の記録（設計書 §5.3）
//
// ★MMS は「立案 → 承認」のときだけ介入を記録していた。だが実際の施策は
//   人が主導しているものが多い（改正対応リライト・記事統合・内部リンク注入）。
//   cowork の intervention-record.py が担っていた入口をここに移す。
//   入口が無いまま MMS を正にすると、記録そのものが止まる。

import { useState, useTransition } from "react";
import { recordManualIntervention } from "./actions";

/** ActionType と JUDGE_DAYS に対応する選択肢（勝手な値を入れさせない） */
const TYPES: { value: string; label: string; days: number }[] = [
  { value: "rewrite", label: "本文リライト", days: 28 },
  { value: "title_meta_rewrite", label: "タイトル・メタ改稿", days: 28 },
  { value: "merge", label: "記事の統合（301）", days: 56 },
  { value: "internal_link", label: "内部リンク追加", days: 28 },
  { value: "cta_move", label: "CTA位置変更", days: 14 },
  { value: "cta_variant", label: "CTA文言変更", days: 14 },
  { value: "lp_section_edit", label: "LPのセクション変更", days: 14 },
  { value: "kw_pivot", label: "狙うKWの変更", days: 56 },
];

const todayJst = () =>
  new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

export function ManualRecord() {
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [externalId, setExternalId] = useState("");
  const [type, setType] = useState("rewrite");
  const [appliedAt, setAppliedAt] = useState(todayJst());
  const [note, setNote] = useState("");

  const days = TYPES.find((t) => t.value === type)?.days ?? 28;

  const submit = () =>
    start(async () => {
      const r = await recordManualIntervention({ externalId, type, appliedAt, note });
      setToast({ msg: r.ok ? r.message : r.error, ok: r.ok });
      if (r.ok) {
        setExternalId("");
        setNote("");
        setOpen(false);
      }
    });

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold">自分で行った施策の記録</h2>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90"
        >
          {open ? "閉じる" : "施策を記録"}
        </button>
      </div>

      <p className="mb-2 text-[12px] text-[var(--faint)]">
        システムが立案していない施策（改正対応のリライト・記事統合・内部リンク注入など）は、
        ここで記録すると<strong>立案経由と同じ経路で自動判定</strong>されます。
        適用前28日の実測を今この場で確保するので、
        <strong>後から遡って記録すると baseline が取れず判定できません</strong>。実施したら都度入れてください。
      </p>

      {toast && (
        <p
          className={`mb-2 rounded-md px-3 py-2 text-[12px] ${
            toast.ok ? "bg-[var(--good)]/12 text-[#0a6b3d]" : "bg-[var(--bad)]/10 text-[var(--bad)]"
          }`}
        >
          {toast.msg}
        </p>
      )}

      {open && (
        <div className="rounded-xl border border-[var(--border-strong)] bg-[var(--panel)] p-3.5">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--muted)]">対象（記事ID・必須）</span>
              <input
                value={externalId}
                onChange={(e) => setExternalId(e.target.value)}
                placeholder="ART-061"
                className="w-[140px] rounded-md border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1.5 text-[12px]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--muted)]">種類</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="rounded-md border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1.5 text-[12px]"
              >
                {TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[var(--muted)]">実施日</span>
              <input
                type="date"
                value={appliedAt}
                max={todayJst()}
                onChange={(e) => setAppliedAt(e.target.value)}
                className="rounded-md border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1.5 text-[12px]"
              />
            </label>
            <span className="pb-2 text-[11px] text-[var(--faint)]">→ {days}日後に自動判定</span>
          </div>
          <label className="mt-2 flex flex-col gap-1">
            <span className="text-[11px] text-[var(--muted)]">
              何をしたか（必須・後で効果を読む材料になります）
            </span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="令和8年度改正40万円対応・H2再構成・リード増厚・タイトル/メタ刷新"
              className="rounded-md border border-[var(--border-strong)] bg-[var(--bg)] px-2 py-1.5 text-[12px]"
            />
          </label>
          <button
            disabled={pending || !externalId.trim() || !note.trim()}
            onClick={submit}
            className="mt-3 rounded-md bg-[var(--ink)] px-3 py-1.5 text-[12px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {pending ? "記録中…" : "記録する"}
          </button>
        </div>
      )}
    </div>
  );
}
