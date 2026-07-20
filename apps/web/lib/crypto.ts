// 個人情報の列単位暗号化（設計書 §16.2 / docs/RULES.md §11-3）
//
//   「Lead の個人情報カラムは**列単位で暗号化**する」
//
// 方式: AES-256-GCM。保存形式は `v1:<iv>:<tag>:<ct>`（いずれも base64url）。
//
// ★fail-closed。鍵が無ければ暗号化せずに保存するのではなく、**エラーで止める**。
//   「鍵が無いから平文で保存」は最悪の挙動なので、構造的に選べないようにする。
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm";
const PREFIX = "v1";

export class PiiKeyMissingError extends Error {
  constructor() {
    super(
      "MMS_PII_KEY が未設定です。個人情報を平文で保存しないため処理を中断しました。" +
        "`openssl rand -base64 32` で生成して .env に設定してください。",
    );
    this.name = "PiiKeyMissingError";
  }
}

function loadKey(): Buffer {
  const raw = process.env.MMS_PII_KEY;
  if (!raw) throw new PiiKeyMissingError();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `MMS_PII_KEY は base64 で 32 バイトである必要があります（現在 ${key.length} バイト）`,
    );
  }
  return key;
}

/** 鍵が正しく設定されているか。ヘルスチェック用（値は返さない） */
export function isPiiKeyReady(): boolean {
  try {
    loadKey();
    return true;
  } catch {
    return false;
  }
}

/** 個人情報を暗号化する。null/空文字はそのまま null を返す */
export function encryptPii(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined) return null;
  const trimmed = String(plain).trim();
  if (!trimmed) return null;

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, loadKey(), iv);
  const ct = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(":");
}

/** 復号する。★この関数を通さずに個人情報を読み出してはならない */
export function decryptPii(envelope: string | null | undefined): string | null {
  if (!envelope) return null;
  const parts = envelope.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("個人情報の保存形式が不正です（暗号化されていない可能性）");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(
    ALGO,
    loadKey(),
    Buffer.from(ivB64, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

/** 封筒形式かどうか（P1 で移行した平文の note と混在しても壊れないように） */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${PREFIX}:`);
}

/**
 * 封筒なら復号し、そうでなければ（P1 移行の平文など）そのまま返す。
 * ★新規書き込みでは必ず encryptPii() を使うこと。この関数は読み取り専用の互換層。
 */
export function decryptIfEncrypted(value: string | null | undefined): string | null {
  if (!value) return null;
  return isEncrypted(value) ? decryptPii(value) : value;
}

/**
 * 表示・ログ・AI 受け渡し用のマスキング（§16.2 / docs/RULES.md §11-1）
 * ★AI に渡してよいのは「興味商材と閲覧履歴」のみ。氏名・連絡先はこの関数を通す。
 */
export function maskContact(value: string | null | undefined): string {
  if (!value) return "—";
  const s = String(value);
  if (s.includes("@")) {
    const [local, domain] = s.split("@");
    return `${local.slice(0, 1)}***@${domain ?? ""}`;
  }
  if (/^[\d+\-() ]+$/.test(s)) return `***-****-${s.replace(/\D/g, "").slice(-4)}`;
  return `${s.slice(0, 1)}***`;
}

/** タイミング攻撃に強い文字列比較 */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
