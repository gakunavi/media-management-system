import { auth, signOut } from "@/auth";
import { prisma } from "@mms/db";

// ★この画面はダッシュボード（段1〜段7）ではない。段1〜3・段7 は P3 で実装する。
//   P0 の完了条件「localhost:3000 にログインできる」を満たすための基盤状態画面。
export const dynamic = "force-dynamic";

async function getDbStatus() {
  try {
    const [{ count }] = await prisma.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*)::bigint AS count FROM information_schema.tables WHERE table_schema = 'public'`;
    return { ok: true as const, tables: Number(count) };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export default async function Home() {
  const session = await auth();
  const db = await getDbStatus();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-10 flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MMS</h1>
          <p className="mt-1 text-sm text-neutral-500">
            メディア管理システム — メディア／SNS運用の獲得基盤
          </p>
        </div>
        {session?.user ? (
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
          >
            <button
              type="submit"
              className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-900"
            >
              ログアウト
            </button>
          </form>
        ) : null}
      </header>

      <section className="mb-8 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
        <h2 className="mb-3 text-sm font-semibold text-neutral-500">
          ログイン中
        </h2>
        <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
          <dt className="text-neutral-500">メール</dt>
          <dd>{session?.user?.email ?? "—"}</dd>
          <dt className="text-neutral-500">権限</dt>
          <dd>
            <code className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs dark:bg-neutral-900">
              {session?.user?.role ?? "—"}
            </code>
          </dd>
        </dl>
      </section>

      <section className="mb-8 rounded-lg border border-neutral-200 p-5 dark:border-neutral-800">
        <h2 className="mb-3 text-sm font-semibold text-neutral-500">
          基盤の状態（P0）
        </h2>
        <ul className="space-y-2 text-sm">
          <li className="flex items-center gap-2">
            <span aria-hidden>{db.ok ? "🟢" : "🔴"}</span>
            <span>
              PostgreSQL 16{" "}
              {db.ok ? (
                <span className="text-neutral-500">
                  （public スキーマに {db.tables} テーブル）
                </span>
              ) : (
                <span className="text-red-600">{db.error}</span>
              )}
            </span>
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden>🟢</span>
            <span>
              Next.js 15 + Auth.js（Email magic link・Role 付き）
            </span>
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden>🟢</span>
            <span>
              worker（Python 常駐・jobs をポーリング）
            </span>
          </li>
        </ul>
      </section>

      <section className="rounded-lg border border-dashed border-neutral-300 p-5 text-sm text-neutral-500 dark:border-neutral-700">
        <p className="mb-2">
          ダッシュボード（段1〜段3・段7）は <strong>P3</strong> で実装します。
        </p>
        <p>
          次の Phase は <strong>P1</strong>（既存データ移行）と{" "}
          <strong>P2</strong>（CV配管）。順序は{" "}
          <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs dark:bg-neutral-900">
            docs/PHASES.md
          </code>{" "}
          の「依存」に従います。
        </p>
      </section>
    </main>
  );
}
