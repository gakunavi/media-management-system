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
      { href: "/leads", label: "リード", phase: "P2.6", ready: false, icon: "leads" },
      { href: "/threads", label: "Threads・代理店", phase: "P5", ready: false, icon: "threads" },
    ],
  },
  {
    title: "コンテンツ",
    items: [
      { href: "/content", label: "記事・投稿", phase: "P7", ready: false, icon: "content" },
      { href: "/clusters", label: "トピッククラスタ", phase: "P4.3", ready: false, icon: "clusters" },
      { href: "/keywords", label: "キーワード", phase: "P4.5", ready: false, icon: "keywords" },
      { href: "/ideas", label: "ネタ", phase: "P4.6", ready: false, icon: "ideas" },
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
      { href: "/experiments", label: "施策・PDCA", phase: "P8", ready: false, icon: "experiments" },
      { href: "/jobs", label: "ジョブ", phase: "P1", ready: false, icon: "jobs" },
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
