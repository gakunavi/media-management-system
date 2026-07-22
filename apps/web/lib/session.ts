// ログイン中のユーザーを解決する（認可の入口）
//
// ★なぜ auth() を直接使わないか（2026-07-23 に発覚）
//   AUTH_URL が https（本番は Cloudflare Tunnel 経由の公開ドメイン）のとき、
//   Auth.js は Cookie 名を `__Secure-authjs.session-token` として読む。
//   一方 localhost の自動ログイン（/api/dev-login）は http なので
//   `__Secure-` 付きの Cookie をブラウザが受け付けず、素の名前で発行している。
//   結果、**localhost では auth() が常に null を返し、owner 限定の
//   Server Action が全て「権限がありません」で落ちていた**
//   （リードの手動登録・LP台帳の登録・ジョブ実行など）。
//   画面が開けてしまうため、誰も気づかないまま「登録できない」だけが残る。
//
// ★直し方の方針
//   本番の Cookie 設定は変えない（Secure 属性を落とすのは後退）。
//   代わりに、**localhost かつ自動ログインが有効なときだけ** 素の Cookie を
//   Session テーブルに突き合わせて解決する。/api/dev-login と同じ三重ガード:
//     1. MMS_DEV_AUTOLOGIN_EMAIL が設定されているときだけ
//     2. Host が localhost / 127.0.0.1 のときだけ
//     3. 有効期限内の Session 行があるときだけ
import { cookies, headers } from "next/headers";
import { prisma } from "@mms/db";
import { auth } from "@/auth";

export type CurrentUser = { id: string; email: string | null; role: string };

const DEV_SESSION_COOKIE = "authjs.session-token";

function isLocalHost(host: string | null): boolean {
  if (!host) return false;
  const name = host.split(":")[0].toLowerCase();
  return name === "localhost" || name === "127.0.0.1" || name === "::1" || name === "[::1]";
}

export async function currentUser(): Promise<CurrentUser | null> {
  const session = await auth();
  if (session?.user?.id) {
    return {
      id: session.user.id,
      email: session.user.email ?? null,
      role: session.user.role ?? "readonly",
    };
  }

  // ── localhost の自動ログイン（素の Cookie）を解決する ──
  if (!(process.env.MMS_DEV_AUTOLOGIN_EMAIL ?? "").trim()) return null;
  const h = await headers();
  if (!isLocalHost(h.get("host"))) return null;

  const token = (await cookies()).get(DEV_SESSION_COOKIE)?.value;
  if (!token) return null;

  const row = await prisma.session.findFirst({
    where: { sessionToken: token, expires: { gt: new Date() } },
    select: { user: { select: { id: true, email: true, role: true } } },
  });
  if (!row?.user) return null;
  return { id: row.user.id, email: row.user.email, role: row.user.role };
}

/** owner だけが実行できる操作の入口。false ならアクションを続けない */
export async function isOwner(): Promise<boolean> {
  const u = await currentUser();
  return u?.role === "owner";
}
