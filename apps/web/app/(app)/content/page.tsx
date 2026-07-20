import { ComingSoon } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      icon="content"
      title="記事・投稿"
      phase="P7"
      description="コンテンツ一覧（console.htmlの後継）"
      willDo={[
        "記事・投稿・リール・LPを buyerFit / funnelStage つきで一覧",
        "記事別のPV/表示/クリック/順位の日次推移",
        "公開日・リライト日・CTA変更日をグラフに注釈表示",
      ]}
    />
  );
}
