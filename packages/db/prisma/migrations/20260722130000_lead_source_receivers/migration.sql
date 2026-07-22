-- 受け皿を実態に合わせて分ける（診断LP / 代理店LP / info メール）
ALTER TYPE "LeadSourceType" ADD VALUE IF NOT EXISTS 'lp_diagnosis';
ALTER TYPE "LeadSourceType" ADD VALUE IF NOT EXISTS 'lp_agency';
ALTER TYPE "LeadSourceType" ADD VALUE IF NOT EXISTS 'email';
