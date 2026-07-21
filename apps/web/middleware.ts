import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// ★このミドルウェアは「未ログインを弾いてサインイン画面へ送る」だけの軽量ガード。
//   Prisma（DBセッション）は Edge ランタイムで動かないため、ここではセッション
//   Cookie の有無しか見ない。**本当の認可判定は必ずサーバー側（auth()）で行う**。
//   → docs/RULES.md §12-3

const PUBLIC_PATHS = [
  "/signin",
  "/api/auth", // Auth.js 自身
  "/api/dev-login", // このMac（localhost）専用の自動ログイン
  "/api/health", // 死活監視（§3.9.3 UptimeCheck が叩く）
  "/api/ingest", // 計測受口（form=HMAC / events=Origin+レート制限）
  // ★内部ジョブ受口。ログインセッションではなく X-MMS-Job-Secret で認証する
  //   （worker からの呼び出しのため）。ルート側で fail-closed 検証している。
  "/api/jobs",
  "/mms-tag.js", // ★計測タグ。外部サイトから読むので公開（§14.2 / P2.5）
];

const SESSION_COOKIES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

function isLocalHost(host: string | null): boolean {
  if (!host) return false;
  const name = host.split(":")[0].toLowerCase();
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const hasSession = SESSION_COOKIES.some((c) => req.cookies.has(c));
  if (hasSession) return NextResponse.next();

  // ★このMac（localhost）からのアクセスで自動ログインが有効なら、
  //   サインイン画面ではなく自動ログインへ回す。
  //   外部（Cloudflare Tunnel 経由）は Host が公開ドメインになるので作動しない。
  // ★standalone は 0.0.0.0 バインドのため req.url のホストが 0.0.0.0 に
  //   なることがある。ユーザーが使った Host を基準にリダイレクト先を組む。
  const host = req.headers.get("host") ?? req.nextUrl.host;
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const origin = `${proto}://${host}`;

  const autoLoginEnabled = Boolean(process.env.MMS_DEV_AUTOLOGIN_EMAIL);
  if (autoLoginEnabled && isLocalHost(host)) {
    const devLoginUrl = new URL("/api/dev-login", origin);
    devLoginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(devLoginUrl);
  }

  const signInUrl = new URL("/signin", origin);
  signInUrl.searchParams.set("callbackUrl", pathname);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  // 静的アセットと画像最適化は対象外
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
