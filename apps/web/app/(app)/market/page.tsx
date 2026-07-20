import { ComingSoon } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      icon="market"
      title="市場・競合"
      phase="P6.7 / P6.8"
      description="市場規模・シェア・競合比較"
      willDo={[
        "クラスタ別の月間検索ボリュームと推移（市場が伸びているか）",
        "表示/クリックシェア・Top3/10/20率・機会損失ランキング",
        "競合ドメインの強さ・AI Overview引用シェア・空白地帯",
      ]}
    />
  );
}
