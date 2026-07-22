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
    // ★代理店専用の画面は置かない（2026-07-23 石井さん）。獲得しているものは
    //   「見込み客」と「代理店見込み」の2種類で、経路が違うだけ。経路ごとの画面の
    //   中で種別を分ける方が、同じ数字が2箇所に散らない:
    //     DMの選別       → リード統計の「代理店見込み」タブ
    //     アングル別の実績 → Threads（投稿の効き）
    //     配布コードの稼働 → LP（そのLPの属性なので）
    //
    // ★並びは「結果 → 受け皿・送客元」（2026-07-23 石井さん指定）。
    //   LP は受け皿（問い合わせの着地点）なので分析ではなく獲得に置く。
    //   もともと cowork の media-console（A/Bテストの分析画面）の後継として
    //   作ったため「分析」にあったが、送客→受け皿の整理では中身が受け皿。
    items: [
      { href: "/leads", label: "リード統計", ready: true, icon: "leads" },
      { href: "/hp", label: "HPの問い合わせ", ready: true, icon: "leads" },
      { href: "/phone", label: "電話", ready: true, icon: "line" },
      { href: "/lp", label: "LP", ready: true, icon: "lp" },
      { href: "/threads", label: "Threads", ready: true, icon: "threads" },
      { href: "/line", label: "公式LINE", ready: true, icon: "line" },
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
