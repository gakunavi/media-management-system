import { ComingSoon } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      icon="ideas"
      title="ネタ"
      phase="P4.6"
      description="記事ネタの自動供給"
      willDo={[
        "5供給源（GSCギャップ・PAA・News・Threadsヒット・AIOミス）から自動起票",
        "impacts（効く結果指標）が空のネタはAPIで弾く",
        "[記事化する] でラッコ取得ジョブまで自動実行",
      ]}
    />
  );
}
