// 認証済み画面の共通シェル（サイドバー + トップバー）
// signin 系は route group の外なのでこのシェルは付かない。
import { signOut } from "@/auth";
import { currentUser } from "@/lib/session";
import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // ★localhost の自動ログインでも role が出るように currentUser を使う
  const user = await currentUser();

  return (
    <div className="min-h-screen">
      <Sidebar />

      {/* コンテンツ領域（サイドバー幅ぶん左に余白） */}
      <div className="pl-60">
        {/* トップバー */}
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--panel)]/80 px-6 backdrop-blur">
          {/* ★年月を直書きしない。月が変わっても直らず、古い月を見ていると誤認する */}
          <div className="text-[13px] text-[var(--muted)]">
            節税総研メディア ・{" "}
            {new Date().toLocaleDateString("ja-JP", {
              timeZone: "Asia/Tokyo",
              year: "numeric",
              month: "long",
            })}
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-[13px] text-[var(--muted)] sm:inline">
              {user?.email}
            </span>
            <span className="rounded-full bg-[var(--accent-weak)] px-2 py-0.5 text-[11px] font-medium text-[var(--accent)]">
              {user?.role ?? "—"}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/signin" });
              }}
            >
              <button className="rounded-md border border-[var(--border-strong)] px-2.5 py-1 text-[13px] text-[var(--muted)] transition-colors hover:bg-[var(--panel-2)]">
                ログアウト
              </button>
            </form>
          </div>
        </header>

        <div className="px-6 py-6">{children}</div>
      </div>
    </div>
  );
}
