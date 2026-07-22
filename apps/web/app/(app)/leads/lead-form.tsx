"use client";

import { useState, useTransition } from "react";
import { createLead } from "./actions";

// リード手動登録フォーム（設計書 §3.8.3 電話から登録・§14.3）
// ★電話受電時は3項目（社名・興味商材・「何を見てお電話しましたか」）でよい（§3.8.3）。
//   ここではそれを含む形で、種別・経路・属性・経路記事まで入力できる。

const field =
  "w-full rounded-md border border-[var(--border-strong)] bg-[var(--panel)] px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--accent)]";
const label = "mb-1 block text-[12px] font-medium text-[var(--muted)]";

export function LeadForm({
  defaultSourceType,
  label: buttonLabel,
}: {
  /** 受け皿を固定して開く（HP・電話の個別画面から使う） */
  defaultSourceType?: string;
  /** ボタンの文言 */
  label?: string;
} = {}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("new");

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await createLead(formData);
      if (res.ok) {
        setOpen(false);
      } else {
        setError(res.error);
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
      >
        {buttonLabel ?? "＋ リードを手動登録"}
      </button>
    );
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:p-8">
      <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">リードを手動登録</h2>
          <button
            onClick={() => setOpen(false)}
            className="text-[var(--faint)] hover:text-[var(--ink)]"
          >
            ✕
          </button>
        </div>

        <form action={onSubmit} className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>種別（何を募集した結果か）</label>
              <select name="type" className={field} defaultValue="direct_inquiry">
                <option value="direct_inquiry">見込み客</option>
                <option value="agency">代理店見込み</option>
                <option value="line_friend">LINE登録</option>
              </select>
            </div>
            <div>
              {/* ★受け皿は7つ。info メールや診断LPが選べないと手入力できない */}
              <label className={label}>受け皿（どこで受けたか）</label>
              <select
                name="sourceType"
                className={field}
                defaultValue={defaultSourceType ?? "phone_manual"}
              >
                <option value="phone_manual">電話</option>
                {/* ★info メールは HPの問い合わせと同一（2026-07-23）。選択肢は1つ */}
                <option value="form">HPの問い合わせ（info メール）</option>
                <option value="lp_diagnosis">診断LP</option>
                <option value="lp_agency">商品LP（代理店経由）</option>
                <option value="line">公式LINE</option>
                <option value="threads_dm">Threads DM</option>
              </select>
            </div>
          </div>

          {/* ★きっかけ（送客元）。電話・メールでも「何を見たか」を聞けば埋まる。
              これが無いと、電話の問い合わせが施策の成果に繋がらない */}
          <div>
            <label className={label}>
              きっかけ（何を見て連絡してきたか）
              <span className="ml-1 font-normal text-[var(--faint)]">
                ★電話・メールでも必ず聞く。分からないときだけ「不明」
              </span>
            </label>
            <select name="origin" className={field} defaultValue="unknown">
              <option value="media_article">メディア記事</option>
              <option value="threads">Threads</option>
              <option value="line">公式LINE</option>
              <option value="lp_diagnosis">診断LP</option>
              <option value="lp_product">商品LP（防災防犯ライト）</option>
              <option value="hp">HP（記事以外）</option>
              <option value="referral">紹介・既存顧客・名刺交換</option>
              <option value="unknown">不明（聞けていない）</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>発生日</label>
              <input type="date" name="occurredAt" defaultValue={today} className={field} />
            </div>
            <div>
              <label className={label}>予算規模</label>
              <select name="budgetTier" className={field} defaultValue="unknown">
                <option value="unknown">不明</option>
                <option value="high">高（1,000万〜）</option>
                <option value="mid">中（300〜1,000万）</option>
                <option value="low">低（〜300万）</option>
              </select>
            </div>
          </div>

          <div>
            <label className={label}>会社名 / 屋号（暗号化して保存）</label>
            <input name="companyName" className={field} placeholder="株式会社◯◯" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>メール（暗号化）</label>
              <input name="contactEmail" className={field} placeholder="任意" />
            </div>
            <div>
              <label className={label}>電話（暗号化）</label>
              <input name="contactPhone" className={field} placeholder="任意" />
            </div>
          </div>

          <div>
            <label className={label}>興味商材（カンマ区切り）</label>
            <input name="interestProduct" className={field} placeholder="ML, IoTビーコン" />
          </div>
          <div>
            <label className={label}>
              比較していた商材（★金脈KWの源泉・§3.1）
            </label>
            <input
              name="competitorsConsidered"
              className={field}
              placeholder="IoTビーコン, 外貨両替機"
            />
          </div>
          <div>
            <label className={label}>
              流入記事 ID（★「何を見てお問い合わせ？」§3.8.3）
            </label>
            <input name="firstTouchExternalId" className={field} placeholder="ART-074" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>状態</label>
              <select
                name="status"
                className={field}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="new">新規</option>
                <option value="contacted">初動済</option>
                <option value="qualified">見込あり</option>
                <option value="proposal">提案中</option>
                <option value="won">成約</option>
                <option value="lost">失注</option>
              </select>
            </div>
            {status === "won" && (
              <div>
                <label className={label}>成約額（税抜・円）</label>
                <input name="closedAmount" className={field} placeholder="4800000" />
              </div>
            )}
          </div>

          <div>
            <label className={label}>メモ（暗号化）</label>
            <textarea name="note" rows={2} className={field} />
          </div>

          {error && (
            <p className="rounded-md bg-[var(--bad)]/10 px-3 py-2 text-[13px] text-[var(--bad)]">
              {error}
            </p>
          )}

          <div className="mt-1 flex justify-end gap-2">
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
              {pending ? "登録中…" : "登録する"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
