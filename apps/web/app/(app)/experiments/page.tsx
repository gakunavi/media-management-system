import { ComingSoon } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      icon="experiments"
      title="施策・PDCA"
      phase="P4 / P8"
      description="施策の立案・実行・判定"
      willDo={[
        "段5「次の一手」の承認/却下と Intervention の自動記録",
        "対照群補正つきの効果判定（positive/neutral/negative）",
        "施策の撤退条件カウントダウン（段6）",
      ]}
    />
  );
}
