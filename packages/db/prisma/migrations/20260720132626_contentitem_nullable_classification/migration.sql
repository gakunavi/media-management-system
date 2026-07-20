-- AlterTable
ALTER TABLE "ContentItem" ALTER COLUMN "articleType" DROP NOT NULL,
ALTER COLUMN "freshnessTier" DROP NOT NULL,
ALTER COLUMN "funnelStage" DROP NOT NULL;
