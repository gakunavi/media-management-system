// 公式LINE の受口（LINE Messaging API Webhook・設計書 §3-7 / §5.4）
//
// ★なぜ要るか
//   2026-07-22、購入検討中の方から公式LINEに2件の問い合わせが来ていたのに、
//   誰も気づいていなかった。MMS は公式LINEを「未計測」として扱い、
//   通知経路も持っていなかった。獲得3ゴールの③が丸ごと素通りしていた。
//
//   ここで解くべきは「記録すること」より **見逃さないこと**。
//   受信した瞬間に Slack へ投げる（§5.4「石井さんへ即通知（最優先）」）。
//
// ★設定するURL: https://collect.asset-support.co.jp/api/ingest/line
//   collect. は Cloudflare Access の対象外。mms. に設定すると LINE 側が
//   Access のログイン画面を受け取り、Webhook が全部失敗する。
//
// ★署名検証は必須。LINE の Webhook URL は推測可能なので、
//   検証が無いと誰でも偽の問い合わせを流し込める。

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@mms/db";
import { encryptPii, isPiiKeyReady } from "@/lib/crypto";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LineEvent = {
  type: string;
  timestamp?: number;
  source?: { userId?: string; type?: string };
  message?: { type?: string; text?: string };
};

/** X-Line-Signature: Base64(HMAC-SHA256(channelSecret, rawBody)) */
function verify(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  // ★長さが違うと timingSafeEqual が例外を投げる
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** 通知に載せる本文の要約。★個人情報を載せない（§16.2） */
function preview(text: string | undefined): string {
  if (!text) return "（テキスト以外）";
  const t = text.replace(/\s+/g, " ").trim();
  // 連絡先らしき文字列は落とす。通知は Slack に残り続ける
  const masked = t
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "（メール）")
    .replace(/0\d{1,4}-?\d{1,4}-?\d{3,4}/g, "（電話番号）");
  return masked.length > 60 ? `${masked.slice(0, 60)}…` : masked;
}

export async function POST(req: Request) {
  const secret = (process.env.MMS_LINE_CHANNEL_SECRET ?? "").trim();
  if (!secret) {
    // ★fail-closed。鍵が無いまま素通りさせると偽の問い合わせを受け入れる
    return NextResponse.json(
      { ok: false, reason: "MMS_LINE_CHANNEL_SECRET が未設定です" },
      { status: 503 },
    );
  }

  const raw = await req.text();
  if (!verify(raw, req.headers.get("x-line-signature"), secret)) {
    return NextResponse.json({ ok: false, reason: "署名が一致しません" }, { status: 401 });
  }

  let body: { events?: LineEvent[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, reason: "JSON として解釈できません" }, { status: 400 });
  }

  const events = Array.isArray(body.events) ? body.events : [];
  let follows = 0;
  let unfollows = 0;
  let messages = 0;

  const business = await prisma.business.findFirst({
    where: { slug: process.env.MMS_DEFAULT_BUSINESS_SLUG ?? "tax-saving-agency" },
    select: { id: true },
  });

  for (const ev of events) {
    const userId = ev.source?.userId;
    if (!userId) continue;
    const at = ev.timestamp ? new Date(ev.timestamp) : new Date();

    if (ev.type === "follow") {
      await prisma.lineFriend.upsert({
        where: { lineUserId: userId },
        update: { status: "active" },
        create: { lineUserId: userId, addedAt: at, status: "active", tags: [] },
      });
      // ★獲得3ゴールの③。Lead にも起こして段1に出す
      if (business) {
        await prisma.lead.create({
          data: {
            businessId: business.id,
            type: "line_friend",
            sourceType: "line",
            occurredAt: at,
          },
        });
      }
      follows += 1;
      continue;
    }

    if (ev.type === "unfollow") {
      await prisma.lineFriend.updateMany({
        where: { lineUserId: userId },
        data: { status: "blocked" },
      });
      unfollows += 1;
      continue;
    }

    if (ev.type === "message") {
      const kind = ev.message?.type ?? "unknown";
      const text = ev.message?.text;
      // ★本文は暗号化して保存する。鍵が無いなら保存しない（平文で置かない）
      const bodyEnc = kind === "text" && text && isPiiKeyReady() ? encryptPii(text) : null;
      await prisma.lineInbound.create({
        data: { lineUserId: userId, receivedAt: at, kind, bodyEnc },
      });
      messages += 1;

      // ★ここが本題。届いた瞬間に知らせる
      await notify({
        event: "line.inbound",
        title: "📩 公式LINEに新しいメッセージ",
        body: [
          `内容: ${preview(text)}`,
          bodyEnc === null && kind === "text"
            ? "★本文は保存していません（MMS_PII_KEY 未設定）"
            : "本文は暗号化して保存しました",
          "※ 返信は LINE 公式アカウントから行ってください",
        ].join("\n"),
        url: `${process.env.MMS_PUBLIC_URL ?? "http://localhost:3000"}/leads`,
      });
    }
  }

  // ★LINE は 2xx を返さないと再送し続ける。処理できなかった種別も 200 で返す
  return NextResponse.json({ ok: true, follows, unfollows, messages });
}
