// ダッシュボードのタブ
//
// ★1画面に全部積むのをやめた理由
//   毎日見るのは「今日の結果」と「止まっていないか」で、
//   計装の穴（どのマスが測れていないか）は週に一度見れば足りる。
//   同じ密度で並べると、毎日見る数字が埋もれる。
//
// ★タブはリンク（クエリ）。状態を持たないので、URLをそのまま共有できる。
import Link from "next/link";

export const TABS = [
  { key: "overview", label: "結果", hint: "問い合わせと、そこに至る階段" },
  { key: "routes", label: "経路", hint: "送客 × 受け皿。どこが測れていないか" },
  { key: "health", label: "健全性", hint: "ジョブ・配信・計測の欠測" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

export function resolveTab(v: string | string[] | undefined): TabKey {
  const k = Array.isArray(v) ? v[0] : v;
  return TABS.some((t) => t.key === k) ? (k as TabKey) : "overview";
}

export function Tabs({
  active,
  query,
}: {
  active: TabKey;
  /** タブ切り替え時に保持するクエリ（期間など） */
  query: Record<string, string | undefined>;
}) {
  const href = (key: string) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) p.set(k, v);
    p.set("tab", key);
    return `/?${p.toString()}`;
  };

  return (
    <div className="mb-4 flex gap-1 border-b border-[var(--border)]">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={href(t.key)}
          title={t.hint}
          className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
            active === t.key
              ? "border-[var(--accent)] text-[var(--accent)]"
              : "border-transparent text-[var(--muted)] hover:text-[var(--ink)]"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
