// 管理コンソールのナビゲーション定義（設計書 §4.2 の画面一覧）
//
// ready=false の画面は該当 Phase で実装する。ナビには出す（システムの全体像が
// 見えることが重要）が、開いたら「準備中（Phase）」を表示する。

export type NavItem = {
  href: string;
  label: string;
  /** 未実装なら担当 Phase を表示する */
  phase?: string;
  ready: boolean;
  icon: string; // lib/icons.tsx のキー
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export const NAV: NavGroup[] = [
  {
    title: "",
    items: [{ href: "/", label: "ダッシュボード", ready: true, icon: "dashboard" }],
  },
  {
    title: "獲得",
    items: [
      { href: "/leads", label: "リード", ready: true, icon: "leads" },
      { href: "/threads", label: "Threads", ready: true, icon: "threads" },
      { href: "/agency", label: "代理店", ready: true, icon: "agency" },
      { href: "/line", label: "公式LINE", ready: true, icon: "line" },
      // ★LP は受け皿（問い合わせの着地点）。分析ではなく獲得（2026-07-23）。
      //   もともと cowork の media-console（A/Bテストの分析画面）の後継として
      //   作ったため「分析」に置いていたが、送客→受け皿の整理では中身が受け皿。
      { href: "/lp", label: "LP", ready: true, icon: "lp" },
    ],
  },
  {
    title: "コンテンツ",
    items: [
      { href: "/content", label: "記事・投稿", ready: true, icon: "content" },
      { href: "/clusters", label: "トピッククラスタ", ready: true, icon: "clusters" },
      { href: "/keywords", label: "キーワード", ready: true, icon: "keywords" },
      { href: "/ideas", label: "ネタ", ready: true, icon: "ideas" },
    ],
  },
  {
    title: "分析",
    items: [
      { href: "/market", label: "市場・競合", phase: "P6.8", ready: false, icon: "market" },
      { href: "/ads", label: "広告", phase: "P3.7", ready: false, icon: "ads" },
    ],
  },
  {
    title: "運用",
    items: [
      { href: "/experiments", label: "施策・PDCA", ready: true, icon: "experiments" },
      { href: "/costs", label: "コスト", ready: true, icon: "costs" },
      { href: "/jobs", label: "ジョブ", ready: true, icon: "jobs" },
    ],
  },
];

/** href → NavItem（ページ側でタイトル等に使う） */
export function findNav(pathname: string): NavItem | null {
  for (const g of NAV) {
    for (const it of g.items) {
      if (it.href === pathname) return it;
    }
  }
  return null;
}
