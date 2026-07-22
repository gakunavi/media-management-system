"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";
import { Icon } from "./icons";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="sb-scroll fixed inset-y-0 left-0 z-20 flex w-60 flex-col overflow-y-auto border-r border-[var(--sb-border)] bg-[var(--sb-bg)] text-[var(--sb-ink)]">
      {/* ロゴ */}
      <div className="flex items-center gap-2.5 px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-sm font-bold text-white">
          M
        </div>
        <div className="leading-tight">
          <div className="text-sm font-bold tracking-wide">MMS</div>
          <div className="text-[10px] text-[var(--sb-muted)]">メディア管理システム</div>
        </div>
      </div>

      <nav className="flex-1 px-3 pb-4">
        {NAV.map((group, gi) => (
          <div key={gi} className="mb-1">
            {group.title && (
              <div className="px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider text-[var(--sb-muted)]">
                {group.title}
              </div>
            )}
            <ul className="space-y-0.5">
              {group.items.map((it) => {
                const active =
                  it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
                return (
                  <li key={it.href}>
                    <Link
                      href={it.href}
                      className={`group flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors ${
                        active
                          ? "bg-[var(--sb-active-bg)] font-medium text-[var(--sb-active-ink)]"
                          : "text-[var(--sb-ink)]/85 hover:bg-white/[0.06]"
                      }`}
                    >
                      <span
                        className={`shrink-0 ${active ? "text-[var(--sb-active-ink)]" : "text-[var(--sb-muted)]"}`}
                      >
                        <Icon name={it.icon} />
                      </span>
                      <span className="flex-1">{it.label}</span>
                      {!it.ready && (
                        <span className="rounded bg-white/[0.08] px-1.5 py-0.5 text-[9px] font-medium text-[var(--sb-muted)]">
                          {it.phase}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-[var(--sb-border)] px-4 py-3 text-[10px] text-[var(--sb-muted)]">
        {/* ★ゴールは問い合わせ数。構造は 送客 → 受け皿 → リード → 成約（2026-07-22） */}
        送客 → 受け皿 → 問い合わせ
      </div>
    </aside>
  );
}
