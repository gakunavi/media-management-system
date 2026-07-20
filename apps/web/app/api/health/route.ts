import { NextResponse } from "next/server";
import { prisma } from "@mms/db";

// 死活監視の受口（設計書 §3.9.3 UptimeCheck / docker healthcheck が叩く）
// ★認証不要。middleware.ts の PUBLIC_PATHS に登録済み
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  let db: "ok" | "error" = "ok";
  let dbError: string | null = null;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (e) {
    db = "error";
    dbError = e instanceof Error ? e.message : String(e);
  }

  const body = {
    service: "mms-web",
    status: db === "ok" ? "ok" : "degraded",
    db,
    dbError,
    responseMs: Date.now() - startedAt,
    // ★docs/RULES.md §9: 全ての日時は JST に正規化して扱う
    checkedAt: new Date().toISOString(),
  };

  return NextResponse.json(body, { status: db === "ok" ? 200 : 503 });
}
