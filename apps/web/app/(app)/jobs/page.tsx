import { ComingSoon } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      icon="jobs"
      title="ジョブ"
      phase="P1（worker稼働中）"
      description="定期ジョブの監視"
      willDo={[
        "GSC取得・AIOバッチ・News monitor などの定期実行",
        "実行履歴（成否・所要時間・ログ）を JobRun で記録",
        "失敗の検知と再キュー（段7と連動）",
      ]}
    />
  );
}
