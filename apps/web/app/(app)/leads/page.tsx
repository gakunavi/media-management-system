import { ComingSoon } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      icon="leads"
      title="リード"
      phase="P2.6 / P2.7"
      description="問い合わせ・成約の一覧と初動対応"
      willDo={[
        "問い合わせを属性・興味・比較対象・流入経路つきで一覧",
        "直客2件を遡及入力し「どの記事が買い手を連れてきたか」を特定",
        "初動自動対応（通知→自動返信→返信ドラフト）と初動速度SLAの監視",
      ]}
    />
  );
}
