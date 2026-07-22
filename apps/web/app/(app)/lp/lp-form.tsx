"use client";

// LP台帳の登録・編集（手入力）
//
// ★LPは増える前提。登録した瞬間から他のLPと同じ読み方で数字が出る。
// ★計測の接頭辞と代理店コードの有無だけは、後から画面のコードを直さずに
//   済むよう台帳に持たせる（それが旧実装の破綻理由だった）。
import { useState, useTransition } from "react";
import { saveLp } from "./actions";

const field =
  "w-full rounded-md border border-[var(--border-strong)] bg-[var(--panel)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]";
const label = "mb-1 block text-[12px] font-medium text-[var(--muted)]";

export type LpFormValues = {
  slug: string;
  name: string;
  url: string;
  lpType: string;
  offer: string;
  status: string;
  variantKeys: string[];
  metricPrefix: string | null;
  hasAgencyCodes: boolean;
};

export function LpForm({ initial }: { initial?: LpFormValues }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const editing = Boolean(initial);

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await saveLp(formData);
      if (res.ok) setOpen(false);
      else setError(res.error);
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={
          editing
            ? "rounded-md border border-[var(--border-strong)] px-2.5 py-1 text-[12px] text-[var(--muted)] transition-colors hover:bg-[var(--panel-2)]"
            : "rounded-md bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
        }
      >
        {editing ? "台帳を編集" : "＋ LPを登録"}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-6">
      <div className="w-full max-w-2xl rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">
            {editing ? "LPを編集" : "LPを台帳に登録"}
          </h2>
          <button
            onClick={() => setOpen(false)}
            className="text-[13px] text-[var(--muted)] hover:text-[var(--ink)]"
          >
            閉じる
          </button>
        </div>

        <form action={onSubmit} className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>名前</label>
              <input
                name="name"
                required
                defaultValue={initial?.name}
                className={field}
                placeholder="防災防犯ライト（商材別）"
              />
            </div>
            <div>
              <label className={label}>
                slug
                <span className="ml-1 font-normal text-[var(--faint)]">
                  {editing ? "（変更不可）" : "画面URLになる"}
                </span>
              </label>
              <input
                name="slug"
                required
                defaultValue={initial?.slug}
                readOnly={editing}
                className={`${field} ${editing ? "opacity-60" : ""}`}
                placeholder="bousai-bouhan-light"
              />
            </div>
          </div>

          <div>
            <label className={label}>LPのURL</label>
            <input
              name="url"
              required
              type="url"
              defaultValue={initial?.url}
              className={field}
              placeholder="https://example.com/lp/"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={label}>種別</label>
              <select name="lpType" className={field} defaultValue={initial?.lpType ?? "product"}>
                <option value="consultation">総合窓口（相談）</option>
                <option value="product">商材別</option>
                <option value="comparison_hub">比較ハブ</option>
                <option value="agency">代理店募集</option>
              </select>
            </div>
            <div>
              <label className={label}>オファー</label>
              <input
                name="offer"
                required
                defaultValue={initial?.offer ?? "無料相談"}
                list="lp-offers"
                className={field}
              />
              <datalist id="lp-offers">
                <option value="無料相談" />
                <option value="資料DL" />
                <option value="診断" />
              </datalist>
            </div>
            <div>
              <label className={label}>状態</label>
              <select name="status" className={field} defaultValue={initial?.status ?? "draft"}>
                <option value="draft">下書き</option>
                <option value="live">公開中</option>
                <option value="paused">停止</option>
                <option value="retired">終了</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>
                A/Bのパターン
                <span className="ml-1 font-normal text-[var(--faint)]">
                  カンマ区切り・空ならA/Bなし
                </span>
              </label>
              <input
                name="variantKeys"
                defaultValue={initial?.variantKeys.join(",")}
                className={field}
                placeholder="a,b,c"
              />
            </div>
            <div>
              <label className={label}>
                計測の接頭辞
                <span className="ml-1 font-normal text-[var(--faint)]">GA4のイベント名</span>
              </label>
              <input
                name="metricPrefix"
                defaultValue={initial?.metricPrefix ?? ""}
                className={field}
                placeholder="lp（→ lp_view_a / lp_form_submit_a）"
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              name="hasAgencyCodes"
              defaultChecked={initial?.hasAgencyCodes}
              className="h-4 w-4"
            />
            代理店コード（?ag=AG-XXXX）を配るLP
            <span className="text-[11px] text-[var(--faint)]">
              有効にすると配布コード別の稼働が個別画面に出ます
            </span>
          </label>

          {error && (
            <p className="rounded-md bg-[var(--bad)]/10 px-3 py-2 text-[12px] text-[var(--bad)]">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-md border border-[var(--border-strong)] px-3 py-1.5 text-[13px] text-[var(--muted)]"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
            >
              {pending ? "保存中…" : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
