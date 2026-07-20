import { ComingSoon } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      icon="clusters"
      title="トピッククラスタ"
      phase="P4.3"
      description="ピラー／クラスターのツリー管理"
      willDo={[
        "既存157記事を自動割当・599本の内部リンクを正規化",
        "ツリー表示（市場規模・シェア・リンク健全度つき）",
        "「ピラー不在」「thin」「孤児」など構造欠陥を検知",
      ]}
    />
  );
}
