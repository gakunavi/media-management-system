// MMS DB クライアント（唯一の Prisma 入口）
// 開発時の HMR で PrismaClient が増殖しないよう globalThis に保持する
import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __mmsPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__mmsPrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "production"
        ? ["warn", "error"]
        : ["query", "warn", "error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.__mmsPrisma = prisma;
