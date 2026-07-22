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
// ★unfollow（ブロック）は扱わない（2026-07-22 石井さん判断）。
//   扱う場合の用途は「送客を増やした直後にブロックが増えていないか」という
//   質の信号だが、いまは友だち0人で送客もこれからなので、判断材料にならない。
//   必要になったら LineFriend.status を blocked にする数行を足せばよい。
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
      //   通知も出す。登録は「来たこと」を知りたい対象（見落とし防止）
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
      await notify({
        event: "line.follow",
        title: "🟢 公式LINEに新しい友だち登録",
        body: "登録がありました。",
      });
      follows += 1;
      continue;
    }

    if (ev.type === "message") {
      // ★本文は保存しない。MMS が持つのは PDCA に使う数（件数）だけで、
      //   内容は LINE 公式アカウント側にある。持たなければ守る必要も無い（§16.2）。
      await prisma.lineInbound.create({
        data: { lineUserId: userId, receivedAt: at, kind: ev.message?.type ?? "unknown" },
      });
      messages += 1;

      // ★通知は「来た」ことだけ伝える。見落とさないためのもので、
      //   内容を読む場所は LINE 公式アカウント。ここに要約を載せると
      //   Slack に個人情報が残り続ける。
      await notify({
        event: "line.inbound",
        title: "📩 公式LINEにメッセージが届きました",
        body: "内容の確認と返信は LINE 公式アカウントから行ってください。",
      });
    }
  }

  // ★LINE は 2xx を返さないと再送し続ける。処理できなかった種別も 200 で返す
  return NextResponse.json({ ok: true, follows, messages });
}
