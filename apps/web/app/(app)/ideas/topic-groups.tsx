"use client";

// ネタを「話題」でまとめて出す。
//
// ★なぜ束ねるか（2026-07-24）
//   実測で35件のうち PAA 15件が**すべて「少額減価償却資産・個人事業主」
//   1トピックの質問違い**、AIO未引用10件のうち4件が「決算賞与通知」の表記違いだった。
//   別々に並べると「35件のネタがある」に見えるが、実際に書く記事は十数本しかない。
//
// ★既存記事があるかを必ず出す。
//   実測ではほぼ全部に既存記事があった（少額減価償却は6本、決算賞与は ART-080）。
//   これを出さないと同じ話題の記事を量産してカニバリを増やす
//   （今日「即時償却」で12記事が競合しているのを見たばかり）。
import { useState } from "react";
import Link from "next/link";
import type { TopicGroup } from "@/lib/ideas";
import { IDEA_SOURCE_LABEL } from "@/lib/ideas";
import { IdeaCard } from "./idea-card";

export function TopicGroups({ groups }: { groups: TopicGroup[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="space-y-2.5">
      {groups.map((g) => {
        const head = g.ideas[0];
        const isOpen = open === g.key;
        return (
          <article
            key={g.key}
            className="rounded-xl border border-[var(--border)] bg-[var(--panel)] p-4"
          >
            <div className="mb-1 flex flex-wrap items-center gap-2">
              {g.sources.map((s) => (
                <span
                  key={s}
                  className="rounded bg-[var(--accent-weak)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent)]"
                >
                  {IDEA_SOURCE_LABEL[s] ?? s}
                </span>
              ))}
              {g.ideas.length > 1 && (
                <span className="rounded bg-[var(--panel-2)] px-1.5 py-0.5 text-[11px] text-[var(--muted)]">
                  同じ話題 {g.ideas.length}件
                </span>
              )}
            </div>

            <div className="text-[13px] font-medium">{head.title}</div>

            {/* ★既存記事があるなら「新規」ではなく「加筆」。ここが判断の分かれ目 */}
            {g.covered.length > 0 ? (
              <div className="mt-1.5 rounded bg-[var(--warn)]/[0.12] px-2 py-1.5 text-[11px] text-[#9a6a00]">
                ★この話題は<strong>既に{g.covered.length}本の記事で扱っています</strong>。
                新規で書くと<strong>同じKWで自社どうしが競合します</strong>。
                既存記事に見出しを足す形を先に検討してください。
                <ul className="mt-1">
                  {g.covered.map((c) => (
                    <li key={c.externalId}>
                      ・
                      <Link
                        href={`/content/${c.externalId}`}
                        className="underline hover:text-[var(--accent)]"
                      >
                        {c.externalId} {c.title}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-1.5 rounded bg-[var(--panel-2)] px-2 py-1 text-[11px] text-[#1a7a2e]">
                この話題を扱う記事はまだありません（新規記事の候補）。
              </p>
            )}

            {g.ideas.length > 1 && (
              <button
                onClick={() => setOpen(isOpen ? null : g.key)}
                className="mt-2 text-[11px] text-[var(--accent)] hover:underline"
              >
                {isOpen ? "個別のネタを閉じる" : `個別のネタ ${g.ideas.length}件を見る`}
              </button>
            )}

            <div className="mt-2 space-y-2">
              {(isOpen ? g.ideas : g.ideas.slice(0, 1)).map((i) => (
                <IdeaCard key={i.id} idea={i} />
              ))}
            </div>
          </article>
        );
      })}
    </div>
  );
}
