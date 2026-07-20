// Webhook 受口の HMAC-SHA256 署名検証（設計書 §8 / docs/RULES.md §12-2）
//
//   「Webhook 受口は HMAC-SHA256 署名検証（共有シークレット）。WPプラグイン/GAS に同鍵」
//
// 送信側は次の2ヘッダを付ける:
//   X-MMS-Timestamp : UNIX 秒
//   X-MMS-Signature : hex(HMAC_SHA256(secret, `${timestamp}.${rawBody}`))
//
// timestamp を署名対象に含めるのは**リプレイ攻撃**を防ぐため。
// 古い署名付きリクエストをそのまま再送されても、許容時間外なら弾ける。
import { createHmac } from "node:crypto";
import { safeEqual } from "./crypto";

export const TIMESTAMP_HEADER = "x-mms-timestamp";
export const SIGNATURE_HEADER = "x-mms-signature";

/** 署名の有効時間（秒）。これを過ぎた署名は受け付けない */
const TOLERANCE_SECONDS = 300;

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string; status: 400 | 401 | 503 };

export function sign(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

export function verifySignature(
  headers: Headers,
  rawBody: string,
  now: Date = new Date(),
): VerifyResult {
  const secret = process.env.MMS_INGEST_SECRET;
  if (!secret) {
    // ★fail-closed。シークレット未設定なら「検証をスキップ」ではなく受け付けない
    return {
      ok: false,
      status: 503,
      reason:
        "MMS_INGEST_SECRET が未設定です。署名検証ができないため受信を拒否しました",
    };
  }

  const timestamp = headers.get(TIMESTAMP_HEADER);
  const signature = headers.get(SIGNATURE_HEADER);
  if (!timestamp || !signature) {
    return {
      ok: false,
      status: 400,
      reason: `${TIMESTAMP_HEADER} と ${SIGNATURE_HEADER} が必要です`,
    };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, status: 400, reason: "timestamp が数値ではありません" };
  }

  const ageSeconds = Math.abs(Math.floor(now.getTime() / 1000) - ts);
  if (ageSeconds > TOLERANCE_SECONDS) {
    return {
      ok: false,
      status: 401,
      reason: `署名の有効期限切れ（${ageSeconds}秒前 / 許容 ${TOLERANCE_SECONDS}秒）`,
    };
  }

  const expected = sign(secret, timestamp, rawBody);
  if (!safeEqual(expected, signature)) {
    return { ok: false, status: 401, reason: "署名が一致しません" };
  }

  return { ok: true };
}
