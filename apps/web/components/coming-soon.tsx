import { Icon } from "./icons";

// 未実装画面のプレースホルダ。ナビには載せて全体像を見せるが、
// 開いたら「どの Phase で・何ができるようになるか」を示す。
export function ComingSoon({
  icon,
  title,
  phase,
  description,
  willDo,
}: {
  icon: string;
  title: string;
  phase: string;
  description: string;
  willDo: string[];
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        <p className="mt-0.5 text-[13px] text-[var(--muted)]">{description}</p>
      </div>

      <div className="rounded-xl border border-dashed border-[var(--border-strong)] bg-[var(--panel)] p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent-weak)] text-[var(--accent)]">
          <Icon name={icon} width={24} height={24} />
        </div>
        <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-[var(--panel-2)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted)]">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--warn)]" />
          {phase} で実装
        </div>
        <h2 className="mt-2 text-base font-semibold">この画面は準備中です</h2>
        <ul className="mx-auto mt-4 max-w-md space-y-1.5 text-left text-[13px] text-[var(--muted)]">
          {willDo.map((w, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-[var(--accent)]">•</span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
