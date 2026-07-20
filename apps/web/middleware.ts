import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ★このミドルウェアは「未ログインを弾いてサインイン画面へ送る」だけの軽量ガード。
//   Prisma（DBセッション）は Edge ランタイムで動かないため、ここではセッション
//   Cookie の有無しか見ない。**本当の認可判定は必ずサーバー側（auth()）で行う**。
//   → docs/RULES.md §12-3

const PUBLIC_PATHS = [
  "/signin",
  "/api/auth", // Auth.js 自身
  "/api/health", // 死活監視（§3.9.3 UptimeCheck が叩く）
  "/api/ingest", // 計測受口は HMAC 署名で検証する（§8 / P2.5）
];

const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const hasSession = SESSION_COOKIES.some((c) => req.cookies.has(c));
  if (hasSession) return NextResponse.next();

  const signInUrl = new URL("/signin", req.url);
  signInUrl.searchParams.set("callbackUrl", pathname);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  // 静的アセットと画像最適化は対象外
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
