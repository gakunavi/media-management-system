import { ComingSoon } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      icon="ads"
      title="広告"
      phase="P3.7 / P7.5"
      description="ユニットエコノミクスと広告運用"
      willDo={[
        "上限CPA・実CPA・ROAS・損益分岐CVR",
        "シミュレーター（順算/逆算・3シナリオ）",
        "キャンペーン実績・予実差分・SEO vs 広告の比較",
      ]}
    />
  );
}
