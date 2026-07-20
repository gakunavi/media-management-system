import { ComingSoon } from "@/components/coming-soon";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <ComingSoon
      icon="threads"
      title="Threads・代理店"
      phase="P5 / P5.6"
      description="SNS運用と代理店DMの管理"
      willDo={[
        "投稿キュー・配信実績・時間帯別成績",
        "代理店DMの状態遷移（received→有効→契約）と歩留まり",
        "viewsPerFollower急落の検知（配信制限のサイン）",
      ]}
    />
  );
}
