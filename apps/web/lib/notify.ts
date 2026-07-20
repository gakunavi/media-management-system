// 即時通知（設計書 §5.4 / §14.7）
//
//   「問い合わせ受信 → Lead 起票 → **石井さんへ即通知（最優先）**」
//   「リードは初動速度でCVRが決まる」
//
// ★配信経路は環境変数で選ぶ。設定されている経路すべてに送る。
//     1. サーバーログ  … 常に出力（設定不要・消えない記録）
//     2. Webhook      … MMS_NOTIFY_WEBHOOK_URL（Slack / Discord / iOSショートカット等）
//     3. メール        … MMS_SMTP_HOST + MMS_NOTIFY_EMAIL
//
// ★どの経路も「送れたか」を AuditLog に必ず残す。
//   通知が届かなかったこと自体に後から気づけるようにする（§3.2.2 の欠測検知と同じ思想）。
import { prisma } from "@mms/db";

export type NotifyPayload = {
  /** 通知の種別（lead.created / uptime.down …） */
  event: string;
  title: string;
  body: string;
  /** 画面で開くべき URL（あれば） */
  url?: string;
  /** ★個人情報を入れてはならない。マスキング済みの値のみ */
  meta?: Record<string, unknown>;
};

type ChannelResult = { channel: string; ok: boolean; detail?: string };

async function viaLog(p: NotifyPayload): Promise<ChannelResult> {
  console.warn(
    [
      "",
      "══════════════════════════════════════════",
      ` 🔔 ${p.title}`,
      "──────────────────────────────────────────",
      p.body,
      p.url ? ` → ${p.url}` : "",
      "══════════════════════════════════════════",
      "",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return { channel: "log", ok: true };
}

async function viaWebhook(p: NotifyPayload): Promise<ChannelResult | null> {
  const url = process.env.MMS_NOTIFY_WEBHOOK_URL;
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Slack / Discord は `text`、汎用受口は全体を見ればよい
      body: JSON.stringify({
        text: `${p.title}\n${p.body}${p.url ? `\n${p.url}` : ""}`,
        event: p.event,
        title: p.title,
        body: p.body,
        url: p.url,
        meta: p.meta,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return {
      channel: "webhook",
      ok: res.ok,
      detail: res.ok ? undefined : `HTTP ${res.status}`,
    };
  } catch (e) {
    return {
      channel: "webhook",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

async function viaEmail(p: NotifyPayload): Promise<ChannelResult | null> {
  const host = process.env.MMS_SMTP_HOST;
  const to = process.env.MMS_NOTIFY_EMAIL;
  if (!host || !to) return null;
  try {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.MMS_SMTP_PORT ?? 587),
      auth: process.env.MMS_SMTP_USER
        ? {
            user: process.env.MMS_SMTP_USER,
            pass: process.env.MMS_SMTP_PASS,
          }
        : undefined,
    });
    await transport.sendMail({
      from: process.env.MMS_SMTP_FROM ?? "mms@localhost",
      to,
      subject: p.title,
      text: `${p.body}${p.url ? `\n\n${p.url}` : ""}`,
    });
    return { channel: "email", ok: true };
  } catch (e) {
    return {
      channel: "email",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * 通知を送る。**例外を投げない** — 通知の失敗が本処理（Lead 起票）を
 * 巻き添えにしてはならない。失敗は AuditLog と戻り値に残す。
 */
export async function notify(p: NotifyPayload): Promise<ChannelResult[]> {
  const results = (
    await Promise.all([viaLog(p), viaWebhook(p), viaEmail(p)])
  ).filter((r): r is ChannelResult => r !== null);

  const delivered = results.filter((r) => r.ok).map((r) => r.channel);
  const failed = results.filter((r) => !r.ok);

  try {
    await prisma.auditLog.create({
      data: {
        actorType: "system",
        actorId: "notify",
        action: p.event,
        entity: "Notification",
        // JSON へ丸めて Prisma の InputJsonValue に確実に適合させる
        after: JSON.parse(
          JSON.stringify({
            title: p.title,
            delivered,
            failed: failed.map((f) => ({ channel: f.channel, detail: f.detail ?? null })),
            // ★個人情報は meta に入れない規約なのでそのまま残せる
            meta: p.meta ?? {},
          }),
        ),
        at: new Date(),
      },
    });
  } catch (e) {
    console.error("AuditLog への通知記録に失敗:", e);
  }

  if (delivered.length === 1 && delivered[0] === "log") {
    console.warn(
      "⚠️ 通知がサーバーログにしか出ていません。" +
        "MMS_NOTIFY_WEBHOOK_URL か MMS_SMTP_HOST+MMS_NOTIFY_EMAIL を設定してください。",
    );
  }

  return results;
}
