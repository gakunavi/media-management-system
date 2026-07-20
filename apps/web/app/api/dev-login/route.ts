// このMac（localhost）からの自動ログイン（石井さんの端末専用）
//
// ★安全設計 — 誤って外部に開かないための三重ガード:
//   1. MMS_DEV_AUTOLOGIN_EMAIL が設定されているときだけ作動（既定は無効）
//   2. Host ヘッダが localhost / 127.0.0.1 のときだけ作動
//      → Cloudflare Tunnel 経由（§8）は Host が公開ドメインになるので**作動しない**。
//        外部アクセスは従来どおり Cloudflare Access + マジックリンクで認証する。
//   3. 対象は MMS_DEV_AUTOLOGIN_EMAIL の1アカウントのみ（任意ログインではない）
//
// 仕組み: Auth.js の DB セッション戦略に合わせ、Session 行を作って
//   `authjs.session-token` Cookie を張るだけ。標準のログインと同じ状態になる。
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@mms/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// localhost は http なので secure なしの Cookie 名（auth.ts と対応）
const SESSION_COOKIE = "authjs.session-token";
const MAX_AGE_DAYS = 30;

function isLocalHost(host: string | null): boolean {
  if (!host) return false;
  const name = host.split(":")[0].toLowerCase();
  return (
    name === "localhost" ||
    name === "127.0.0.1" ||
    name === "::1" ||
    name === "[::1]"
  );
}

/**
 * リダイレクト先の絶対 URL を **Host ヘッダ基準**で組み立てる。
 * ★standalone サーバーは 0.0.0.0 にバインドするため req.url のホストが
 *   0.0.0.0 になることがある。それをそのまま返すとブラウザが 0.0.0.0 へ
 *   飛ばされ、Cookie（ドメイン localhost）が送られず自動ログインが空回りする。
 */
function localUrl(req: Request, path: string): URL {
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  return new URL(path, `${proto}://${host}`);
}

export async function GET(req: Request) {
  const email = process.env.MMS_DEV_AUTOLOGIN_EMAIL?.trim();
  const url = new URL(req.url);
  const callbackUrl = url.searchParams.get("callbackUrl") || "/";
  const backToSignin = NextResponse.redirect(localUrl(req, "/signin"));

  // ガード1: 無効なら通常のサインインへ
  if (!email) return backToSignin;
  // ガード2: localhost 以外（＝外部公開経由）では作動しない
  if (!isLocalHost(req.headers.get("host"))) return backToSignin;

  // ガード3: 対象アカウントを owner として用意
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, role: "owner" },
  });

  const sessionToken = randomUUID();
  const expires = new Date(Date.now() + MAX_AGE_DAYS * 86_400_000);
  await prisma.session.create({
    data: { sessionToken, userId: user.id, expires },
  });

  // callbackUrl は同一オリジンのパスだけ許可（オープンリダイレクト防止）
  const safePath = callbackUrl.startsWith("/") ? callbackUrl : "/";
  const res = NextResponse.redirect(localUrl(req, safePath));
  res.cookies.set(SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    expires,
  });
  return res;
}
