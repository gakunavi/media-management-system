# MMS web（Next.js 15 standalone）
# ビルドコンテキストはリポジトリルート（docker-compose.yml 参照）
# Prisma のエンジンは musl より glibc の方が事故が少ないため debian slim を使う

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ── 依存解決 ───────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN npm ci

# ── マイグレーション実行用（compose の migrate サービスが使う）──────
FROM base AS migrator
COPY --from=deps /app/node_modules ./node_modules
COPY packages/db ./packages/db
CMD ["npx", "prisma", "migrate", "deploy", "--schema", "packages/db/prisma/schema.prisma"]

# ── ビルド ────────────────────────────────────────────────
FROM base AS builder
# npm workspaces は root の node_modules に巻き上げるので root だけコピーすれば足りる
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate --schema packages/db/prisma/schema.prisma
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace @mms/web

# ── 実行 ──────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/public ./apps/web/public

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

CMD ["node", "apps/web/server.js"]
