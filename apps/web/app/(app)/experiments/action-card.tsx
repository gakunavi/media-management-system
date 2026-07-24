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
        {/* ★「どれくらい効きそうか」を数字で出す。
            表示回数が母数なので、少ないものは直しても動く余地が無い */}
        {action.impressions28 !== null && (
          <span className="tnum text-[11px] text-[var(--muted)]">
            28日 表示 {action.impressions28.toLocaleString("ja-JP")}
            {action.clicks28 !== null && ` / クリック ${action.clicks28}`}
            {action.avgPosition !== null && ` / ${action.avgPosition.toFixed(1)}位`}
          </span>
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

      {/* ★同じ記事に重ねて手を入れない。どちらの効果か分からなくなる */}
      {action.blockedBy && (
        <p className="mb-1.5 rounded bg-[var(--warn)]/[0.12] px-2 py-1 text-[11px] text-[#9a6a00]">
          ★この記事は <strong>{action.blockedBy.type}</strong> の判定待ち（
          {action.blockedBy.evaluateAt.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })}）。
          いま重ねると<strong>どちらの効果か分からなくなります</strong>。判定後に。
        </p>
      )}
      {/* ★指名検索が主なものは、タイトルを直してもクリックは増えない（§4-24） */}
      {!action.blockedBy &&
        action.navigationalShare !== null &&
        action.navigationalShare >= 0.5 && (
          <p className="mb-1.5 rounded bg-[var(--warn)]/[0.12] px-2 py-1 text-[11px] text-[#9a6a00]">
            ★表示の{Math.round(action.navigationalShare * 100)}%が「国税庁 …」型の
            <strong>指名検索</strong>。利用者は公式ページを開きに来ているので、
            <strong>タイトルを直してもクリックは増えません</strong>。
          </p>
        )}
      {/* ★どのクエリに向けて直すかが分からないなら、タイトル修正の前提が崩れる。
          cowork: AIモード合成クエリ汚染の典型症状（ART-061は表示503の95%が合成、
          人間クエリの実順位は23.2位だった） */}
      {!action.blockedBy &&
        action.type !== "new_article" &&
        action.queryCoverage !== null &&
        action.queryCoverage < 0.3 && (
          <p className="mb-1.5 rounded bg-[var(--warn)]/[0.12] px-2 py-1 text-[11px] text-[#9a6a00]">
            ★表示のうち<strong>検索語まで分かっているのは
            {Math.round(action.queryCoverage * 100)}%</strong>だけ。
            GSCは表示の少ないクエリを伏せるので、これは
            <strong>極端に細かいクエリに散っている</strong>ことを意味します。
            どのクエリに向けて直せばよいか決まらないため、
            <strong>タイトル/メタ単独では効きません</strong>。
            本文のH2再構成・リード増厚に振り替えるか、まず検索語を確認してください。
          </p>
        )}
      {!action.blockedBy && action.weakEvidence && (
        <p className="mb-1.5 rounded bg-[var(--panel-2)] px-2 py-1 text-[11px] text-[var(--muted)]">
          ★根拠が弱い（28日の表示{" "}
          {action.impressions28 === null ? "不明" : action.impressions28}）。
          表示が少ないと順位もCTRも偶然で動くため、直しても<strong>効果を測れません</strong>。
        </p>
      )}
      {/* ★新規記事は表示が少なくて当たり前（SERPに居ないから）。
          「根拠が弱い」ではなく、その少ない表示が需要の証拠になる */}
      {action.type === "new_article" && action.impressions28 !== null && (
        <p className="mb-1.5 rounded bg-[var(--panel-2)] px-2 py-1 text-[11px] text-[var(--muted)]">
          ★SERPに自社が1本も無いので<strong>表示が少ないのは当たり前</strong>です。
          この {action.impressions28} 表示は「Googleが関連と認識している」証拠で、
          記事を作れば取りに行ける余地があるという意味です。
          <strong>効果が出るまで6〜12ヶ月</strong>かかります。
        </p>
      )}

      <div className="text-[13px] font-medium">{action.title}</div>
      <p className="mt-1 text-[12px] leading-relaxed text-[var(--muted)]">{action.rationale}</p>

      {/* ★内部リンクは1本ごとの効果を分離測定できない（cowork）。
          「自動判定」と書くと、出ない数字を待つことになる */}
      {action.type === "internal_link" ? (
        <p className="mt-1.5 text-[11px] text-[var(--faint)]">
          ★<strong>1本ごとの効果は測れません</strong>。承認後は
          <strong>ピラー側の表示回数・順位を月次で見て</strong>判定します
          （個別の対照群比較は成立しないため）。
        </p>
      ) : (
        action.evaluateDays && (
          <p className="mt-1.5 text-[11px] text-[var(--faint)]">
            承認すると {action.evaluateDays}日後に効果を自動判定（対照群補正つき・§5.3）
          </p>
        )
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
