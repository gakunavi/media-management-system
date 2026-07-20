import { ComingSoon } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      icon="keywords"
      title="キーワード"
      phase="P4.5"
      description="KW・順位・カニバリ・鮮度の管理"
      willDo={[
        "KW / 狙い / 割当記事 / 現在順位 / 前週差 / 次の一手を1行で",
        "main重複（カニバリ）をDB制約で自動検出",
        "striking distance（11〜20位）を自動抽出して起票",
      ]}
    />
  );
}
