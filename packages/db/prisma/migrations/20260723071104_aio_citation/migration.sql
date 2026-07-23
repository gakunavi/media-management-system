-- ★このマイグレーションは AioCitation の追加だけを行う。
--
--   Prisma が生成した SQL には
--     ALTER TABLE "LandingPage" ALTER COLUMN "variantKeys" DROP DEFAULT;
--   が混ざっていた。これは LandingPage 追加時から存在するドリフト
--   （DB 側に '{}'::text[] のデフォルトがあり schema には書かれていない）で、
--   今回の変更とは無関係。巻き込むと意図しない副作用になるため外した。
--   RULES §20-6「生成SQLを目視し、余計なものは削る」に従う。

-- CreateTable
CREATE TABLE "AioCitation" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "citedDomains" TEXT[],
    "citedCompetitors" TEXT[],
    "hasPrivateCompetitor" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AioCitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AioCitation_date_idx" ON "AioCitation"("date");

-- CreateIndex
CREATE INDEX "AioCitation_hasPrivateCompetitor_idx" ON "AioCitation"("hasPrivateCompetitor");

-- CreateIndex
CREATE UNIQUE INDEX "AioCitation_contentItemId_engine_date_key" ON "AioCitation"("contentItemId", "engine", "date");

-- AddForeignKey
ALTER TABLE "AioCitation" ADD CONSTRAINT "AioCitation_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
