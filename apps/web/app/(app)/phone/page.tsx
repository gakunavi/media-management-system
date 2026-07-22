import { getReceiverStats } from "@/lib/receivers";
import { resolveRange } from "@/lib/period";
import { RangePicker } from "@/components/range-picker";
import { ReceiverScreen } from "@/components/receiver-screen";
import { LeadForm } from "../leads/lead-form";

// 電話
//
// ★自動取得はできないが測定不能ではない（2026-07-23 石井さん）。
//   いきなり電話してくる人はほとんどおらず、何かの施策に触れている。
//   受電時に「何を見てお電話いただきましたか」を聞いて記録すれば、
//   電話も施策の成果として数えられる。
export const dynamic = "force-dynamic";

export default async function PhonePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const range = resolveRange(await searchParams);
  const stats = await getReceiverStats(["phone_manual"], "lead_direct_inquiry", range);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">電話</h1>
          <p className="mt-0.5 text-[13px] text-[var(--muted)]">
            {range.label}・受電時に手入力。★「何を見てお電話いただきましたか」が唯一の経路情報
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <RangePicker range={range} basePath="/phone" />
          <LeadForm defaultSourceType="phone_manual" label="＋ 記録する" />
        </div>
      </div>

      <ReceiverScreen
        stats={stats}
        note="コールトラッキング（月数千円）は件数が月10件を超えたら再検討します。それまでは受電時のヒアリングが唯一の経路情報です。"
      />
    </div>
  );
}
