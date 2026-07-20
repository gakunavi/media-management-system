// MMS 認証（設計書 §8 / docs/RULES.md §12）
//   - Auth.js v5（Email magic link）
//   - Role（owner / partner / readonly）を最初から持たせる
//   - セッションは DB 戦略（Prisma アダプタ）
//
// ★SMTP が未設定でも P0 を検証できるよう、未設定時はマジックリンクを
//   サーバーログに出力する（開発フォールバック）。本番では必ず SMTP を設定する。
import NextAuth from "next-auth";
import Nodemailer from "next-auth/providers/nodemailer";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@mms/db";

const smtpHost = process.env.MMS_SMTP_HOST;
const smtpConfigured = Boolean(smtpHost);

const mailFrom = process.env.MMS_SMTP_FROM ?? "mms@localhost";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  trustHost: true,
  pages: { signIn: "/signin", verifyRequest: "/signin/sent" },
  providers: [
    Nodemailer({
      from: mailFrom,
      server: smtpConfigured
        ? {
            host: smtpHost,
            port: Number(process.env.MMS_SMTP_PORT ?? 587),
            auth: process.env.MMS_SMTP_USER
              ? {
                  user: process.env.MMS_SMTP_USER,
                  pass: process.env.MMS_SMTP_PASS,
                }
              : undefined,
          }
        : // 未設定時もプロバイダの型を満たすためのダミー。実送信はしない
          { host: "localhost", port: 25 },
      ...(smtpConfigured
        ? {}
        : {
            // SMTP 未設定時は送信せずログに出す（P0 の動作確認用）
            async sendVerificationRequest({
              identifier,
              url,
            }: {
              identifier: string;
              url: string;
            }) {
              console.warn(
                [
                  "",
                  "─────────────────────────────────────────────",
                  " MMS_SMTP_HOST が未設定のためメールを送信しません。",
                  " 下のリンクをブラウザで開くとログインできます。",
                  ` 宛先: ${identifier}`,
                  ` リンク: ${url}`,
                  "─────────────────────────────────────────────",
                  "",
                ].join("\n"),
              );
            },
          }),
    }),
  ],
  callbacks: {
    // DB セッションなので user がそのまま渡ってくる。Role をセッションに載せる
    session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.role = (user as { role?: string }).role ?? "readonly";
      }
      return session;
    },
  },
});
