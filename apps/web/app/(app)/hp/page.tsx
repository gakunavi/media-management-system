import { getReceiverStats } from "@/lib/receivers";
import { resolveRange } from "@/lib/period";
import { RangePicker } from "@/components/range-picker";
import { ReceiverScreen } from "@/components/receiver-screen";
import { LeadForm } from "../leads/lead-form";

// HPの問い合わせ（＝ info メール）
//
// ★HPの問い合わせフォームと info メールは同一（2026-07-23 石井さん訂正）。
//   フォーム送信が info@ に届くだけで、別経路ではない。受け皿は1つ。
//   旧 `email` の行が残っている場合に備えて両方を集計対象にする。
export const dynamic = "force-dynamic";

export default async function HpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const range = resolveRange(await searchParams);
  const stats = await getReceiverStats(["form", "email"], "lead_direct_inquiry", range);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">HPの問い合わせ</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            {range.label}・フォーム送信（info@ に届くメール）。WPのWebhookで自動記録＋手入力
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RangePicker range={range} basePath="/hp" />
          <LeadForm defaultSourceType="form" label="＋ 記録する" />
        </div>
      </div>

      <ReceiverScreen
        stats={stats}
        note="HP訪問 → CTA表示 → クリック → 送信 のうち、いま計測できているのは「送信」だけです（HPのGA4が未接続）。どこで落ちているかは、計装が入るまで分かりません。"
      />
    </div>
  );
}
