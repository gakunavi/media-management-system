-- CreateEnum
CREATE TYPE "TargetTier" AS ENUM ('north_star', 'leading', 'guardrail');

-- CreateEnum
CREATE TYPE "ArticleType" AS ENUM ('pillar', 'cluster', 'news', 'lp', 'reel', 'post');

-- CreateEnum
CREATE TYPE "FreshnessTier" AS ENUM ('breaking', 'commercial', 'evergreen', 'reference');

-- CreateEnum
CREATE TYPE "ReviewState" AS ENUM ('fresh', 'due_soon', 'overdue', 'in_rewrite');

-- CreateEnum
CREATE TYPE "AioTier" AS ENUM ('hot', 'warm', 'cold', 'none');

-- CreateEnum
CREATE TYPE "BudgetTier" AS ENUM ('high', 'mid', 'low', 'unknown');

-- CreateEnum
CREATE TYPE "FunnelStage" AS ENUM ('awareness', 'comparison', 'product_deep', 'decision');

-- CreateEnum
CREATE TYPE "ReviewerType" AS ENUM ('ai', 'ishii');

-- CreateEnum
CREATE TYPE "ArticleReviewKind" AS ENUM ('periodic', 'triggered_by_rank', 'triggered_by_law', 'triggered_by_gsc');

-- CreateEnum
CREATE TYPE "ArticleReviewOutcome" AS ENUM ('no_change', 'minor_fix', 'substantive_rewrite', 'archived');

-- CreateEnum
CREATE TYPE "CtaPosition" AS ENUM ('hero', 'mid', 'final', 'sidebar');

-- CreateEnum
CREATE TYPE "FunnelStep" AS ENUM ('cta_view', 'cta_click', 'lp_view', 'lp_scroll', 'form_view', 'form_field', 'submit', 'phone_click');

-- CreateEnum
CREATE TYPE "LeadType" AS ENUM ('direct_inquiry', 'agency', 'line_friend');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'contacted', 'qualified', 'proposal', 'won', 'lost');

-- CreateEnum
CREATE TYPE "LeadSourceType" AS ENUM ('form', 'phone_manual', 'line', 'threads_dm');

-- CreateEnum
CREATE TYPE "AgencyLeadStage" AS ENUM ('received', 'screening_sent', 'answered', 'qualified', 'forwarded', 'contracted', 'rejected');

-- CreateEnum
CREATE TYPE "PillarType" AS ENUM ('A_standard', 'B_news', 'C_risk');

-- CreateEnum
CREATE TYPE "ClusterState" AS ENUM ('healthy', 'pillar_missing', 'thin', 'cannibalized', 'orphan', 'overgrown');

-- CreateEnum
CREATE TYPE "ClusterRole" AS ENUM ('primary', 'secondary');

-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('main', 'sub');

-- CreateEnum
CREATE TYPE "InternalLinkType" AS ENUM ('cluster_to_pillar', 'pillar_to_cluster', 'cluster_to_cluster', 'cross_pillar');

-- CreateEnum
CREATE TYPE "VolumeSource" AS ENUM ('rakko', 'dataforseo');

-- CreateEnum
CREATE TYPE "AdPlatform" AS ENUM ('google_ads', 'meta', 'yahoo', 'line');

-- CreateEnum
CREATE TYPE "AcquisitionChannel" AS ENUM ('direct', 'agency');

-- CreateEnum
CREATE TYPE "Provenance" AS ENUM ('measured', 'declared', 'estimated');

-- CreateEnum
CREATE TYPE "SimulationMode" AS ENUM ('forward', 'reverse');

-- CreateEnum
CREATE TYPE "SimulationScenario" AS ENUM ('conservative', 'base', 'optimistic');

-- CreateEnum
CREATE TYPE "IdeaSource" AS ENUM ('gsc_gap', 'rakko_paa', 'news', 'threads_hit', 'aio_miss', 'lead_competitor', 'manual');

-- CreateEnum
CREATE TYPE "ExperimentState" AS ENUM ('running', 'won', 'lost', 'withdrawn');

-- CreateEnum
CREATE TYPE "ActionState" AS ENUM ('proposed', 'prepared', 'awaiting_approval', 'approved', 'rejected', 'done', 'failed');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('title_meta_rewrite', 'cta_move', 'cta_variant', 'lp_section_edit', 'internal_link', 'new_article', 'kw_pivot', 'threads_format_shift', 'stop_low_fit');

-- CreateEnum
CREATE TYPE "ConfidenceLevel" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "InterventionVerdict" AS ENUM ('pending', 'positive', 'neutral', 'negative', 'inconclusive');

-- CreateEnum
CREATE TYPE "CoverageState" AS ENUM ('indexed', 'crawled_not_indexed', 'discovered_not_indexed', 'excluded', 'error');

-- CreateEnum
CREATE TYPE "TouchpointRole" AS ENUM ('first', 'assist', 'last');

-- CreateEnum
CREATE TYPE "DeviceType" AS ENUM ('mobile', 'desktop');

-- CreateEnum
CREATE TYPE "PageExperienceSource" AS ENUM ('crux', 'psi');

-- CreateEnum
CREATE TYPE "ProductionCostKind" AS ENUM ('new', 'rewrite', 'image', 'video');

-- CreateEnum
CREATE TYPE "TrafficSource" AS ENUM ('organic', 'ai_search', 'social', 'direct', 'referral', 'paid');

-- CreateEnum
CREATE TYPE "AiEngine" AS ENUM ('chatgpt', 'perplexity', 'copilot', 'gemini');

-- CreateEnum
CREATE TYPE "LifecycleAction" AS ENUM ('keep', 'improve', 'merge', 'noindex', 'redirect', 'delete');

-- CreateEnum
CREATE TYPE "SplitTestState" AS ENUM ('running', 'concluded', 'aborted');

-- CreateEnum
CREATE TYPE "SplitArm" AS ENUM ('treatment', 'control');

-- CreateEnum
CREATE TYPE "ExperimentationTarget" AS ENUM ('lp', 'cta', 'form');

-- CreateEnum
CREATE TYPE "ExperimentationMetric" AS ENUM ('submit_rate', 'cta_click_rate');

-- CreateEnum
CREATE TYPE "ExperimentationState" AS ENUM ('draft', 'running', 'concluded', 'underpowered');

-- CreateEnum
CREATE TYPE "RegulatoryEventType" AS ENUM ('outline', 'enactment', 'enforcement', 'expiry', 'public_comment');

-- CreateEnum
CREATE TYPE "RegulatoryEventStatus" AS ENUM ('scheduled', 'occurred', 'cancelled');

-- CreateEnum
CREATE TYPE "LpType" AS ENUM ('consultation', 'product', 'comparison_hub', 'agency');

-- CreateEnum
CREATE TYPE "LandingPageStatus" AS ENUM ('draft', 'live', 'paused', 'retired');

-- CreateEnum
CREATE TYPE "LinkTier" AS ENUM ('tier1', 'tier2', 'other');

-- CreateEnum
CREATE TYPE "Sentiment" AS ENUM ('positive', 'neutral', 'negative');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "IncidentCategory" AS ENUM ('performance', 'data_quality', 'availability', 'security', 'quality');

-- CreateEnum
CREATE TYPE "VersionCapturedBy" AS ENUM ('pre_intervention', 'post_intervention', 'manual');

-- CreateEnum
CREATE TYPE "PerfGatePhase" AS ENUM ('before', 'after');

-- CreateEnum
CREATE TYPE "PerfGateTarget" AS ENUM ('wp_theme', 'tracker', 'lp', 'plugin');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('owner', 'partner', 'readonly');

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "accountRef" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Target" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "targetValue" DOUBLE PRECISION NOT NULL,
    "tier" "TargetTier" NOT NULL,
    "parentMetric" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshot" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "channelId" TEXT,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "date" DATE NOT NULL,
    "granularity" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasurementCoverage" (
    "id" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "channelId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3),
    "method" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MeasurementCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentItem" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "status" TEXT NOT NULL,
    "articleType" "ArticleType" NOT NULL,
    "isPillar" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT,
    "mainKeywordId" TEXT,
    "charCount" INTEGER,
    "eyecatchType" TEXT,
    "eyecatchColor" TEXT,
    "targetLabel" TEXT,
    "wpPostId" INTEGER,
    "wpCategoryId" INTEGER,
    "tagIds" INTEGER[],
    "publishedAt" TIMESTAMP(3),
    "infoBaseDate" TIMESTAMP(3),
    "dataUpdatedAt" TIMESTAMP(3),
    "lastReviewedAt" TIMESTAMP(3),
    "freshnessTier" "FreshnessTier" NOT NULL,
    "nextReviewDue" TIMESTAMP(3),
    "reviewState" "ReviewState" NOT NULL DEFAULT 'fresh',
    "seoCheckPassed" BOOLEAN NOT NULL DEFAULT false,
    "complianceVerdict" TEXT,
    "factCheckVerdict" TEXT,
    "validatorRun" JSONB,
    "aioTier" "AioTier" NOT NULL DEFAULT 'none',
    "aioTracked" BOOLEAN NOT NULL DEFAULT false,
    "aioTierUpdatedAt" TIMESTAMP(3),
    "aioNote" TEXT,
    "budgetTier" "BudgetTier" NOT NULL DEFAULT 'unknown',
    "funnelStage" "FunnelStage" NOT NULL,
    "productFit" TEXT[],
    "audience" TEXT[],
    "buyerFitScore" INTEGER,
    "impacts" TEXT[],
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticleReview" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "reviewer" "ReviewerType" NOT NULL,
    "kind" "ArticleReviewKind" NOT NULL,
    "findings" JSONB,
    "outcome" "ArticleReviewOutcome" NOT NULL,
    "updatedDataUpdatedAt" BOOLEAN NOT NULL DEFAULT false,
    "interventionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FreshnessRule" (
    "id" TEXT NOT NULL,
    "freshnessTier" "FreshnessTier" NOT NULL,
    "intervalDays" INTEGER NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FreshnessRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentMetric" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cta" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "position" "CtaPosition" NOT NULL,
    "variant" TEXT,
    "targetUrl" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorSession" (
    "id" TEXT NOT NULL,
    "visitorId" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "landingContentId" TEXT,
    "referrer" TEXT,
    "utm" JSONB,
    "fromParam" TEXT,
    "pageviews" INTEGER NOT NULL DEFAULT 0,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "trafficSource" "TrafficSource",
    "aiEngine" "AiEngine",
    "variantAssignments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitorSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "step" "FunnelStep" NOT NULL,
    "contentItemId" TEXT,
    "ctaId" TEXT,
    "lpId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FunnelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" "LeadType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "firstResponseAt" TIMESTAMP(3),
    "companyType" TEXT,
    "budgetTier" "BudgetTier" NOT NULL DEFAULT 'unknown',
    "interestProduct" TEXT[],
    "urgency" TEXT,
    "firstTouchContentId" TEXT,
    "lastTouchContentId" TEXT,
    "sourceKeywordId" TEXT,
    "sourceChannelId" TEXT,
    "sessionId" TEXT,
    "competitorsConsidered" TEXT[],
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "closedAmount" DECIMAL(14,2),
    "closedAt" TIMESTAMP(3),
    "sourceType" "LeadSourceType" NOT NULL,
    "m2DealId" TEXT,
    "m2SyncedAt" TIMESTAMP(3),
    "m2Stage" TEXT,
    "m2ClosedAmount" DECIMAL(14,2),
    "m2ClosedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyLead" (
    "id" TEXT NOT NULL,
    "threadsUserId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "sourcePostId" TEXT,
    "stage" "AgencyLeadStage" NOT NULL,
    "screeningAnswers" JSONB,
    "forwardedAt" TIMESTAMP(3),
    "partnerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentPartnerId" TEXT,
    "commissionRate" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "lastDealAt" TIMESTAMP(3),
    "dealCount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineFriend" (
    "id" TEXT NOT NULL,
    "lineUserId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL,
    "sourceContentId" TEXT,
    "sourceParam" TEXT,
    "tags" TEXT[],
    "status" TEXT NOT NULL,
    "convertedLeadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineFriend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LineMessage" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "targetTags" TEXT[],
    "delivered" INTEGER NOT NULL DEFAULT 0,
    "opened" INTEGER NOT NULL DEFAULT 0,
    "clicked" INTEGER NOT NULL DEFAULT 0,
    "blocked" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LineMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keyword" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "volume" INTEGER,
    "difficulty" INTEGER,
    "cpc" DOUBLE PRECISION,
    "intent" TEXT,
    "budgetTier" "BudgetTier" NOT NULL DEFAULT 'unknown',
    "funnelStage" "FunnelStage",
    "productFit" TEXT[],
    "priority" TEXT,
    "status" TEXT,
    "keywordClusterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordResearch" (
    "id" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "suggests" JSONB,
    "related" JSONB,
    "cooccurrence" JSONB,
    "competitorH2" JSONB,
    "qaQuestions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeywordResearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordAssignment" (
    "id" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "role" "AssignmentRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeywordAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordRanking" (
    "id" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "position" DOUBLE PRECISION NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeywordRanking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicCluster" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parentId" TEXT,
    "pillarContentId" TEXT,
    "pillarType" "PillarType" NOT NULL,
    "productFit" TEXT[],
    "budgetTier" "BudgetTier" NOT NULL DEFAULT 'unknown',
    "funnelStage" "FunnelStage",
    "targetKeywordId" TEXT,
    "state" "ClusterState" NOT NULL DEFAULT 'healthy',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicCluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentCluster" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "role" "ClusterRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentCluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InternalLink" (
    "id" TEXT NOT NULL,
    "srcContentId" TEXT NOT NULL,
    "dstContentId" TEXT NOT NULL,
    "anchorText" TEXT,
    "contextSection" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "linkType" "InternalLinkType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InternalLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClusterMetric" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "granularity" TEXT NOT NULL,
    "articleCount" INTEGER NOT NULL,
    "pillarPresent" BOOLEAN NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "avgPosition" DOUBLE PRECISION,
    "pv" INTEGER NOT NULL DEFAULT 0,
    "top3Count" INTEGER NOT NULL DEFAULT 0,
    "top10Count" INTEGER NOT NULL DEFAULT 0,
    "top20Count" INTEGER NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "deals" INTEGER NOT NULL DEFAULT 0,
    "revenue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "buyerFitClickShare" DOUBLE PRECISION,
    "marketVolume" INTEGER,
    "clickShare" DOUBLE PRECISION,
    "linkHealthScore" DOUBLE PRECISION,
    "cannibalCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClusterMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordVolume" (
    "id" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "volume" INTEGER NOT NULL,
    "source" "VolumeSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeywordVolume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordCluster" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "productFit" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeywordCluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SerpSnapshot" (
    "id" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "position" INTEGER NOT NULL,
    "domain" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "isOurs" BOOLEAN NOT NULL DEFAULT false,
    "hasAiOverview" BOOLEAN NOT NULL DEFAULT false,
    "aioCitedDomains" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SerpSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "label" TEXT,
    "isTracked" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorMetric" (
    "id" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "top3Count" INTEGER NOT NULL DEFAULT 0,
    "top10Count" INTEGER NOT NULL DEFAULT 0,
    "avgPosition" DOUBLE PRECISION,
    "estimatedClicks" INTEGER,
    "shareOfClicks" DOUBLE PRECISION,
    "rankedKeywords" INTEGER,
    "backlinks" INTEGER,
    "refDomains" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompetitorMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CtrCurve" (
    "id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "ctr" DOUBLE PRECISION NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL,
    "segment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CtrCurve_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketShare" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "marketVolume" INTEGER NOT NULL,
    "ourImpressions" INTEGER NOT NULL DEFAULT 0,
    "ourClicks" INTEGER NOT NULL DEFAULT 0,
    "impressionShare" DOUBLE PRECISION,
    "clickShare" DOUBLE PRECISION,
    "top3Rate" DOUBLE PRECISION,
    "top10Rate" DOUBLE PRECISION,
    "top20Rate" DOUBLE PRECISION,
    "aioCitationRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketShare_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "volume" INTEGER NOT NULL,
    "currentPosition" DOUBLE PRECISION,
    "currentClicks" INTEGER NOT NULL DEFAULT 0,
    "targetPosition" DOUBLE PRECISION NOT NULL,
    "potentialClicks" INTEGER NOT NULL,
    "clickGap" INTEGER NOT NULL,
    "estimatedLeads" DOUBLE PRECISION,
    "effortScore" DOUBLE PRECISION,
    "priorityScore" DOUBLE PRECISION,
    "paidCpc" DOUBLE PRECISION,
    "paidCostToMatch" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdAccount" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "platform" "AdPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdCampaign" (
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT,
    "targetLpId" TEXT,
    "dailyBudget" DECIMAL(14,2),
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdGroup" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT[],
    "audience" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdCreative" (
    "id" TEXT NOT NULL,
    "adGroupId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "imageUrl" TEXT,
    "landingUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdCreative_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdMetricDaily" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "adGroupId" TEXT,
    "creativeId" TEXT,
    "date" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "cpc" DOUBLE PRECISION,
    "ctr" DOUBLE PRECISION,
    "cpa" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdMetricDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnitEconomics" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productFit" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "acquisitionChannel" "AcquisitionChannel" NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "ourSharePct" DOUBLE PRECISION NOT NULL,
    "partnerCommissionPct" DOUBLE PRECISION,
    "grossProfitPerUnit" DECIMAL(14,2) NOT NULL,
    "avgUnitsPerDeal" DOUBLE PRECISION NOT NULL,
    "leadToDealRate" DOUBLE PRECISION,
    "maxCpa" DECIMAL(14,2),
    "directPremium" DECIMAL(14,2),
    "actualCpa" DECIMAL(14,2),
    "roas" DOUBLE PRECISION,
    "provenance" "Provenance" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnitEconomics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdSimulation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mode" "SimulationMode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scenario" "SimulationScenario" NOT NULL,
    "inputs" JSONB NOT NULL,
    "outputs" JSONB NOT NULL,
    "assumptionSource" JSONB NOT NULL,
    "actualLinkedCampaignId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdSimulation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Idea" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "source" "IdeaSource" NOT NULL,
    "sourceRef" JSONB,
    "impacts" TEXT[],
    "budgetTier" "BudgetTier" NOT NULL DEFAULT 'unknown',
    "funnelStage" "FunnelStage",
    "estValue" DOUBLE PRECISION,
    "state" TEXT NOT NULL,
    "keywordId" TEXT,
    "contentItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Idea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "successMetric" TEXT NOT NULL,
    "successThreshold" DOUBLE PRECISION NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "evaluateAt" TIMESTAMP(3) NOT NULL,
    "exitCondition" TEXT NOT NULL,
    "state" "ExperimentState" NOT NULL DEFAULT 'running',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Action" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "experimentId" TEXT,
    "type" "ActionType" NOT NULL,
    "title" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "impacts" TEXT[],
    "proposedBy" TEXT NOT NULL,
    "state" "ActionState" NOT NULL DEFAULT 'proposed',
    "preparedArtifact" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Action_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionEvent" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Intervention" (
    "id" TEXT NOT NULL,
    "actionId" TEXT NOT NULL,
    "contentItemId" TEXT,
    "keywordId" TEXT,
    "type" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL,
    "evaluateAt" TIMESTAMP(3) NOT NULL,
    "baseline" JSONB,
    "result" JSONB,
    "controlDelta" DOUBLE PRECISION,
    "netEffect" DOUBLE PRECISION,
    "verdict" "InterventionVerdict" NOT NULL DEFAULT 'pending',
    "controlGroupSize" INTEGER,
    "confidence" "ConfidenceLevel",
    "batchId" TEXT,
    "beforeVersionId" TEXT,
    "afterVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Intervention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Learning" (
    "id" TEXT NOT NULL,
    "businessId" TEXT,
    "experimentId" TEXT,
    "interventionId" TEXT,
    "body" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Learning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "alternatives" TEXT,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "config" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "log" TEXT,
    "metrics" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IndexStatus" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "coverageState" "CoverageState" NOT NULL,
    "canonicalUrl" TEXT,
    "isCanonicalSelf" BOOLEAN NOT NULL DEFAULT true,
    "robotsDirective" TEXT,
    "lastCrawledAt" TIMESTAMP(3),
    "sitemapIncluded" BOOLEAN NOT NULL DEFAULT false,
    "richResultValid" BOOLEAN,
    "richResultErrors" JSONB,
    "mobileUsable" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IndexStatus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadTouchpoint" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL,
    "sequenceNo" INTEGER NOT NULL,
    "dwellSeconds" INTEGER,
    "scrollDepth" DOUBLE PRECISION,
    "role" "TouchpointRole" NOT NULL,
    "attributionWeight" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadTouchpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backlink" (
    "id" TEXT NOT NULL,
    "targetContentId" TEXT,
    "sourceDomain" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "anchorText" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "lost" BOOLEAN NOT NULL DEFAULT false,
    "domainRank" INTEGER,
    "isNofollow" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Backlink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainAuthority" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "refDomains" INTEGER NOT NULL,
    "backlinks" INTEGER NOT NULL,
    "rankScore" DOUBLE PRECISION,
    "competitorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DomainAuthority_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PageExperience" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "device" "DeviceType" NOT NULL,
    "lcp" DOUBLE PRECISION,
    "inp" DOUBLE PRECISION,
    "cls" DOUBLE PRECISION,
    "ttfb" DOUBLE PRECISION,
    "performanceScore" DOUBLE PRECISION,
    "source" "PageExperienceSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PageExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionCost" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "kind" "ProductionCostKind" NOT NULL,
    "humanMinutes" INTEGER NOT NULL DEFAULT 0,
    "aiTokens" INTEGER NOT NULL DEFAULT 0,
    "aiCostYen" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "externalCostYen" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "producedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentLifecycle" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "action" "LifecycleAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "mergeTargetId" TEXT,
    "redirectTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentLifecycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UrlRedirect" (
    "id" TEXT NOT NULL,
    "fromPath" TEXT NOT NULL,
    "toPath" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL DEFAULT 301,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UrlRedirect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SplitTest" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "changeType" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "minSampleImpressions" INTEGER NOT NULL,
    "state" "SplitTestState" NOT NULL DEFAULT 'running',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SplitTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SplitAssignment" (
    "id" TEXT NOT NULL,
    "splitTestId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "arm" "SplitArm" NOT NULL,
    "stratum" TEXT NOT NULL,
    "baseline" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SplitAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experimentation" (
    "id" TEXT NOT NULL,
    "targetType" "ExperimentationTarget" NOT NULL,
    "targetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "trafficSplit" JSONB NOT NULL,
    "primaryMetric" "ExperimentationMetric" NOT NULL,
    "minSamplePerArm" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "concludedAt" TIMESTAMP(3),
    "winnerVariantId" TEXT,
    "state" "ExperimentationState" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experimentation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Variant" (
    "id" TEXT NOT NULL,
    "experimentationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "isControl" BOOLEAN NOT NULL DEFAULT false,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "convRate" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Variant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonalityIndex" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT,
    "keywordId" TEXT,
    "month" INTEGER NOT NULL,
    "indexValue" DOUBLE PRECISION NOT NULL,
    "sampleYears" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeasonalityIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryEvent" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "eventType" "RegulatoryEventType" NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "affectedProducts" TEXT[],
    "sourceUrl" TEXT,
    "status" "RegulatoryEventStatus" NOT NULL DEFAULT 'scheduled',
    "affectedContentIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegulatoryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SnsAccountHealth" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "followers" INTEGER NOT NULL,
    "followersDelta" INTEGER NOT NULL DEFAULT 0,
    "postsDelivered" INTEGER NOT NULL DEFAULT 0,
    "postsFailed" INTEGER NOT NULL DEFAULT 0,
    "avgViews" DOUBLE PRECISION,
    "viewsPerFollower" DOUBLE PRECISION,
    "restrictionSuspected" BOOLEAN NOT NULL DEFAULT false,
    "tokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SnsAccountHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostSchedule" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "hourOfDay" INTEGER NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "avgViews" DOUBLE PRECISION,
    "avgEngagement" DOUBLE PRECISION,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrossPromotion" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "postContentItemId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrossPromotion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LandingPage" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lpType" "LpType" NOT NULL,
    "productFit" TEXT[],
    "budgetTier" "BudgetTier" NOT NULL DEFAULT 'unknown',
    "offer" TEXT NOT NULL,
    "status" "LandingPageStatus" NOT NULL DEFAULT 'draft',
    "publishedAt" TIMESTAMP(3),
    "currentVersionId" TEXT,
    "sourceContentIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LandingPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LpVersion" (
    "id" TEXT NOT NULL,
    "landingPageId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "html" TEXT NOT NULL,
    "config" JSONB,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LpVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkCheck" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isExternal" BOOLEAN NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "statusCode" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "redirectedTo" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "tier" "LinkTier" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UptimeCheck" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "statusCode" INTEGER,
    "responseMs" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UptimeCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenerationProvenance" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "skillName" TEXT NOT NULL,
    "skillVersion" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "promptHash" TEXT,
    "configSnapshot" JSONB,
    "validatorResults" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandMention" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "snippet" TEXT,
    "foundAt" TIMESTAMP(3) NOT NULL,
    "sentiment" "Sentiment" NOT NULL,
    "entity" TEXT NOT NULL,
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandMention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelemetryVolume" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "hour" INTEGER NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "events" INTEGER NOT NULL DEFAULT 0,
    "eventsPerSession" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "bytesReceived" INTEGER NOT NULL DEFAULT 0,
    "rejectedDuplicates" INTEGER NOT NULL DEFAULT 0,
    "anomaly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TelemetryVolume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerfGate" (
    "id" TEXT NOT NULL,
    "releaseTag" TEXT NOT NULL,
    "target" "PerfGateTarget" NOT NULL,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "phase" "PerfGatePhase" NOT NULL,
    "lcp" DOUBLE PRECISION,
    "inp" DOUBLE PRECISION,
    "cls" DOUBLE PRECISION,
    "ttfb" DOUBLE PRECISION,
    "jsBytes" INTEGER,
    "requestCount" INTEGER,
    "passed" BOOLEAN NOT NULL DEFAULT false,
    "blockedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PerfGate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "severity" "IncidentSeverity" NOT NULL,
    "category" "IncidentCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "symptom" TEXT NOT NULL,
    "rootCause" TEXT,
    "resolution" TEXT,
    "preventionActions" JSONB,
    "relatedPhase" TEXT,
    "relatedContentIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostPattern" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "structure" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonitorRun" (
    "id" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "scenario" TEXT NOT NULL,
    "expected" JSONB NOT NULL,
    "actual" JSONB NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "diff" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MonitorRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataQualityCheck" (
    "id" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "ourValue" DOUBLE PRECISION,
    "refValue" DOUBLE PRECISION,
    "deviationPct" DOUBLE PRECISION,
    "verdict" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataQualityCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "leadId" TEXT,
    "visitorId" TEXT,
    "consentType" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "agreedAt" TIMESTAMP(3) NOT NULL,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataRetentionPolicy" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "lastPurgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataRetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "at" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentVersion" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "title" TEXT,
    "metaDescription" TEXT,
    "bodyHtml" TEXT,
    "configYaml" JSONB,
    "tags" INTEGER[],
    "rankMath" JSONB,
    "ctaLayout" JSONB,
    "capturedBy" "VersionCapturedBy" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'readonly',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("provider","providerAccountId")
);

-- CreateTable
CREATE TABLE "Session" (
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationToken_pkey" PRIMARY KEY ("identifier","token")
);

-- CreateIndex
CREATE UNIQUE INDEX "Business_slug_key" ON "Business"("slug");

-- CreateIndex
CREATE INDEX "Business_status_idx" ON "Business"("status");

-- CreateIndex
CREATE INDEX "Channel_businessId_idx" ON "Channel"("businessId");

-- CreateIndex
CREATE INDEX "Channel_type_idx" ON "Channel"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Channel_businessId_type_accountRef_key" ON "Channel"("businessId", "type", "accountRef");

-- CreateIndex
CREATE INDEX "Target_businessId_period_idx" ON "Target"("businessId", "period");

-- CreateIndex
CREATE INDEX "Target_tier_idx" ON "Target"("tier");

-- CreateIndex
CREATE UNIQUE INDEX "Target_businessId_period_metric_key" ON "Target"("businessId", "period", "metric");

-- CreateIndex
CREATE INDEX "MetricSnapshot_businessId_metric_date_idx" ON "MetricSnapshot"("businessId", "metric", "date");

-- CreateIndex
CREATE INDEX "MetricSnapshot_date_idx" ON "MetricSnapshot"("date");

-- CreateIndex
CREATE UNIQUE INDEX "MetricSnapshot_businessId_channelId_metric_date_granularity_key" ON "MetricSnapshot"("businessId", "channelId", "metric", "date", "granularity");

-- CreateIndex
CREATE INDEX "MeasurementCoverage_metric_startedAt_idx" ON "MeasurementCoverage"("metric", "startedAt");

-- CreateIndex
CREATE INDEX "MeasurementCoverage_channelId_idx" ON "MeasurementCoverage"("channelId");

-- CreateIndex
CREATE INDEX "ContentItem_channelId_idx" ON "ContentItem"("channelId");

-- CreateIndex
CREATE INDEX "ContentItem_articleType_idx" ON "ContentItem"("articleType");

-- CreateIndex
CREATE INDEX "ContentItem_status_idx" ON "ContentItem"("status");

-- CreateIndex
CREATE INDEX "ContentItem_budgetTier_funnelStage_idx" ON "ContentItem"("budgetTier", "funnelStage");

-- CreateIndex
CREATE INDEX "ContentItem_reviewState_nextReviewDue_idx" ON "ContentItem"("reviewState", "nextReviewDue");

-- CreateIndex
CREATE INDEX "ContentItem_publishedAt_idx" ON "ContentItem"("publishedAt");

-- CreateIndex
CREATE INDEX "ContentItem_mainKeywordId_idx" ON "ContentItem"("mainKeywordId");

-- CreateIndex
CREATE UNIQUE INDEX "ContentItem_channelId_externalId_key" ON "ContentItem"("channelId", "externalId");

-- CreateIndex
CREATE INDEX "ArticleReview_contentItemId_reviewedAt_idx" ON "ArticleReview"("contentItemId", "reviewedAt");

-- CreateIndex
CREATE INDEX "ArticleReview_kind_idx" ON "ArticleReview"("kind");

-- CreateIndex
CREATE INDEX "ArticleReview_outcome_idx" ON "ArticleReview"("outcome");

-- CreateIndex
CREATE UNIQUE INDEX "FreshnessRule_freshnessTier_key" ON "FreshnessRule"("freshnessTier");

-- CreateIndex
CREATE INDEX "ContentMetric_contentItemId_metric_date_idx" ON "ContentMetric"("contentItemId", "metric", "date");

-- CreateIndex
CREATE INDEX "ContentMetric_date_idx" ON "ContentMetric"("date");

-- CreateIndex
CREATE INDEX "ContentMetric_metric_date_idx" ON "ContentMetric"("metric", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ContentMetric_contentItemId_metric_date_key" ON "ContentMetric"("contentItemId", "metric", "date");

-- CreateIndex
CREATE INDEX "Cta_contentItemId_position_idx" ON "Cta"("contentItemId", "position");

-- CreateIndex
CREATE INDEX "Cta_active_idx" ON "Cta"("active");

-- CreateIndex
CREATE INDEX "VisitorSession_visitorId_idx" ON "VisitorSession"("visitorId");

-- CreateIndex
CREATE INDEX "VisitorSession_firstSeenAt_idx" ON "VisitorSession"("firstSeenAt");

-- CreateIndex
CREATE INDEX "VisitorSession_landingContentId_idx" ON "VisitorSession"("landingContentId");

-- CreateIndex
CREATE INDEX "VisitorSession_trafficSource_idx" ON "VisitorSession"("trafficSource");

-- CreateIndex
CREATE INDEX "VisitorSession_converted_idx" ON "VisitorSession"("converted");

-- CreateIndex
CREATE INDEX "FunnelEvent_sessionId_occurredAt_idx" ON "FunnelEvent"("sessionId", "occurredAt");

-- CreateIndex
CREATE INDEX "FunnelEvent_step_occurredAt_idx" ON "FunnelEvent"("step", "occurredAt");

-- CreateIndex
CREATE INDEX "FunnelEvent_contentItemId_step_idx" ON "FunnelEvent"("contentItemId", "step");

-- CreateIndex
CREATE INDEX "FunnelEvent_lpId_step_idx" ON "FunnelEvent"("lpId", "step");

-- CreateIndex
CREATE UNIQUE INDEX "FunnelEvent_sessionId_step_contentItemId_occurredAt_key" ON "FunnelEvent"("sessionId", "step", "contentItemId", "occurredAt");

-- CreateIndex
CREATE INDEX "Lead_businessId_type_occurredAt_idx" ON "Lead"("businessId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_sourceType_idx" ON "Lead"("sourceType");

-- CreateIndex
CREATE INDEX "Lead_firstTouchContentId_idx" ON "Lead"("firstTouchContentId");

-- CreateIndex
CREATE INDEX "Lead_lastTouchContentId_idx" ON "Lead"("lastTouchContentId");

-- CreateIndex
CREATE INDEX "Lead_m2DealId_idx" ON "Lead"("m2DealId");

-- CreateIndex
CREATE INDEX "AgencyLead_stage_idx" ON "AgencyLead"("stage");

-- CreateIndex
CREATE INDEX "AgencyLead_receivedAt_idx" ON "AgencyLead"("receivedAt");

-- CreateIndex
CREATE INDEX "AgencyLead_sourcePostId_idx" ON "AgencyLead"("sourcePostId");

-- CreateIndex
CREATE INDEX "Partner_status_idx" ON "Partner"("status");

-- CreateIndex
CREATE INDEX "Partner_parentPartnerId_idx" ON "Partner"("parentPartnerId");

-- CreateIndex
CREATE INDEX "Partner_lastDealAt_idx" ON "Partner"("lastDealAt");

-- CreateIndex
CREATE UNIQUE INDEX "LineFriend_lineUserId_key" ON "LineFriend"("lineUserId");

-- CreateIndex
CREATE INDEX "LineFriend_addedAt_idx" ON "LineFriend"("addedAt");

-- CreateIndex
CREATE INDEX "LineFriend_sourceContentId_idx" ON "LineFriend"("sourceContentId");

-- CreateIndex
CREATE INDEX "LineFriend_status_idx" ON "LineFriend"("status");

-- CreateIndex
CREATE INDEX "LineMessage_sentAt_idx" ON "LineMessage"("sentAt");

-- CreateIndex
CREATE INDEX "LineMessage_kind_idx" ON "LineMessage"("kind");

-- CreateIndex
CREATE INDEX "Keyword_businessId_idx" ON "Keyword"("businessId");

-- CreateIndex
CREATE INDEX "Keyword_budgetTier_funnelStage_idx" ON "Keyword"("budgetTier", "funnelStage");

-- CreateIndex
CREATE INDEX "Keyword_keywordClusterId_idx" ON "Keyword"("keywordClusterId");

-- CreateIndex
CREATE INDEX "Keyword_priority_idx" ON "Keyword"("priority");

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_businessId_keyword_key" ON "Keyword"("businessId", "keyword");

-- CreateIndex
CREATE INDEX "KeywordResearch_keywordId_fetchedAt_idx" ON "KeywordResearch"("keywordId", "fetchedAt");

-- CreateIndex
CREATE INDEX "KeywordResearch_expiresAt_idx" ON "KeywordResearch"("expiresAt");

-- CreateIndex
CREATE INDEX "KeywordAssignment_contentItemId_idx" ON "KeywordAssignment"("contentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordAssignment_keywordId_role_key" ON "KeywordAssignment"("keywordId", "role");

-- CreateIndex
CREATE INDEX "KeywordRanking_keywordId_date_idx" ON "KeywordRanking"("keywordId", "date");

-- CreateIndex
CREATE INDEX "KeywordRanking_date_idx" ON "KeywordRanking"("date");

-- CreateIndex
CREATE INDEX "KeywordRanking_position_idx" ON "KeywordRanking"("position");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordRanking_keywordId_date_key" ON "KeywordRanking"("keywordId", "date");

-- CreateIndex
CREATE INDEX "TopicCluster_businessId_idx" ON "TopicCluster"("businessId");

-- CreateIndex
CREATE INDEX "TopicCluster_parentId_idx" ON "TopicCluster"("parentId");

-- CreateIndex
CREATE INDEX "TopicCluster_state_idx" ON "TopicCluster"("state");

-- CreateIndex
CREATE UNIQUE INDEX "TopicCluster_businessId_slug_key" ON "TopicCluster"("businessId", "slug");

-- CreateIndex
CREATE INDEX "ContentCluster_clusterId_role_idx" ON "ContentCluster"("clusterId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ContentCluster_contentItemId_clusterId_key" ON "ContentCluster"("contentItemId", "clusterId");

-- CreateIndex
CREATE INDEX "InternalLink_srcContentId_idx" ON "InternalLink"("srcContentId");

-- CreateIndex
CREATE INDEX "InternalLink_dstContentId_idx" ON "InternalLink"("dstContentId");

-- CreateIndex
CREATE INDEX "InternalLink_linkType_idx" ON "InternalLink"("linkType");

-- CreateIndex
CREATE UNIQUE INDEX "InternalLink_srcContentId_dstContentId_anchorText_key" ON "InternalLink"("srcContentId", "dstContentId", "anchorText");

-- CreateIndex
CREATE INDEX "ClusterMetric_clusterId_date_idx" ON "ClusterMetric"("clusterId", "date");

-- CreateIndex
CREATE INDEX "ClusterMetric_date_idx" ON "ClusterMetric"("date");

-- CreateIndex
CREATE UNIQUE INDEX "ClusterMetric_clusterId_date_granularity_key" ON "ClusterMetric"("clusterId", "date", "granularity");

-- CreateIndex
CREATE INDEX "KeywordVolume_month_idx" ON "KeywordVolume"("month");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordVolume_keywordId_month_source_key" ON "KeywordVolume"("keywordId", "month", "source");

-- CreateIndex
CREATE INDEX "KeywordCluster_businessId_idx" ON "KeywordCluster"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "KeywordCluster_businessId_name_key" ON "KeywordCluster"("businessId", "name");

-- CreateIndex
CREATE INDEX "SerpSnapshot_date_domain_idx" ON "SerpSnapshot"("date", "domain");

-- CreateIndex
CREATE INDEX "SerpSnapshot_domain_idx" ON "SerpSnapshot"("domain");

-- CreateIndex
CREATE INDEX "SerpSnapshot_isOurs_idx" ON "SerpSnapshot"("isOurs");

-- CreateIndex
CREATE UNIQUE INDEX "SerpSnapshot_keywordId_date_position_key" ON "SerpSnapshot"("keywordId", "date", "position");

-- CreateIndex
CREATE UNIQUE INDEX "Competitor_domain_key" ON "Competitor"("domain");

-- CreateIndex
CREATE INDEX "Competitor_isTracked_idx" ON "Competitor"("isTracked");

-- CreateIndex
CREATE INDEX "CompetitorMetric_month_idx" ON "CompetitorMetric"("month");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorMetric_competitorId_month_key" ON "CompetitorMetric"("competitorId", "month");

-- CreateIndex
CREATE INDEX "CtrCurve_segment_position_idx" ON "CtrCurve"("segment", "position");

-- CreateIndex
CREATE UNIQUE INDEX "CtrCurve_position_segment_calculatedAt_key" ON "CtrCurve"("position", "segment", "calculatedAt");

-- CreateIndex
CREATE INDEX "MarketShare_month_idx" ON "MarketShare"("month");

-- CreateIndex
CREATE UNIQUE INDEX "MarketShare_clusterId_month_key" ON "MarketShare"("clusterId", "month");

-- CreateIndex
CREATE INDEX "Opportunity_month_priorityScore_idx" ON "Opportunity"("month", "priorityScore");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_keywordId_month_key" ON "Opportunity"("keywordId", "month");

-- CreateIndex
CREATE INDEX "AdAccount_businessId_idx" ON "AdAccount"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "AdAccount_platform_externalId_key" ON "AdAccount"("platform", "externalId");

-- CreateIndex
CREATE INDEX "AdCampaign_status_idx" ON "AdCampaign"("status");

-- CreateIndex
CREATE INDEX "AdCampaign_targetLpId_idx" ON "AdCampaign"("targetLpId");

-- CreateIndex
CREATE UNIQUE INDEX "AdCampaign_adAccountId_externalId_key" ON "AdCampaign"("adAccountId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "AdGroup_campaignId_externalId_key" ON "AdGroup"("campaignId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "AdCreative_adGroupId_externalId_key" ON "AdCreative"("adGroupId", "externalId");

-- CreateIndex
CREATE INDEX "AdMetricDaily_date_idx" ON "AdMetricDaily"("date");

-- CreateIndex
CREATE INDEX "AdMetricDaily_campaignId_date_idx" ON "AdMetricDaily"("campaignId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AdMetricDaily_campaignId_adGroupId_creativeId_date_key" ON "AdMetricDaily"("campaignId", "adGroupId", "creativeId", "date");

-- CreateIndex
CREATE INDEX "UnitEconomics_month_idx" ON "UnitEconomics"("month");

-- CreateIndex
CREATE UNIQUE INDEX "UnitEconomics_businessId_productFit_month_acquisitionChanne_key" ON "UnitEconomics"("businessId", "productFit", "month", "acquisitionChannel");

-- CreateIndex
CREATE INDEX "AdSimulation_businessId_createdAt_idx" ON "AdSimulation"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "Idea_businessId_source_idx" ON "Idea"("businessId", "source");

-- CreateIndex
CREATE INDEX "Idea_state_idx" ON "Idea"("state");

-- CreateIndex
CREATE INDEX "Idea_estValue_idx" ON "Idea"("estValue");

-- CreateIndex
CREATE INDEX "Experiment_businessId_state_idx" ON "Experiment"("businessId", "state");

-- CreateIndex
CREATE INDEX "Experiment_evaluateAt_idx" ON "Experiment"("evaluateAt");

-- CreateIndex
CREATE INDEX "Action_businessId_state_idx" ON "Action"("businessId", "state");

-- CreateIndex
CREATE INDEX "Action_type_idx" ON "Action"("type");

-- CreateIndex
CREATE INDEX "Action_expiresAt_idx" ON "Action"("expiresAt");

-- CreateIndex
CREATE INDEX "ActionEvent_actionId_at_idx" ON "ActionEvent"("actionId", "at");

-- CreateIndex
CREATE INDEX "ActionEvent_event_idx" ON "ActionEvent"("event");

-- CreateIndex
CREATE UNIQUE INDEX "Intervention_actionId_key" ON "Intervention"("actionId");

-- CreateIndex
CREATE INDEX "Intervention_evaluateAt_verdict_idx" ON "Intervention"("evaluateAt", "verdict");

-- CreateIndex
CREATE INDEX "Intervention_contentItemId_idx" ON "Intervention"("contentItemId");

-- CreateIndex
CREATE INDEX "Intervention_batchId_idx" ON "Intervention"("batchId");

-- CreateIndex
CREATE INDEX "Intervention_type_idx" ON "Intervention"("type");

-- CreateIndex
CREATE INDEX "Learning_businessId_at_idx" ON "Learning"("businessId", "at");

-- CreateIndex
CREATE INDEX "Learning_interventionId_idx" ON "Learning"("interventionId");

-- CreateIndex
CREATE INDEX "Decision_decidedAt_idx" ON "Decision"("decidedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Job_name_key" ON "Job"("name");

-- CreateIndex
CREATE INDEX "Job_enabled_idx" ON "Job"("enabled");

-- CreateIndex
CREATE INDEX "JobRun_jobId_startedAt_idx" ON "JobRun"("jobId", "startedAt");

-- CreateIndex
CREATE INDEX "JobRun_status_idx" ON "JobRun"("status");

-- CreateIndex
CREATE INDEX "IndexStatus_contentItemId_checkedAt_idx" ON "IndexStatus"("contentItemId", "checkedAt");

-- CreateIndex
CREATE INDEX "IndexStatus_coverageState_idx" ON "IndexStatus"("coverageState");

-- CreateIndex
CREATE INDEX "LeadTouchpoint_contentItemId_role_idx" ON "LeadTouchpoint"("contentItemId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "LeadTouchpoint_leadId_sequenceNo_key" ON "LeadTouchpoint"("leadId", "sequenceNo");

-- CreateIndex
CREATE INDEX "Backlink_targetContentId_idx" ON "Backlink"("targetContentId");

-- CreateIndex
CREATE INDEX "Backlink_sourceDomain_idx" ON "Backlink"("sourceDomain");

-- CreateIndex
CREATE INDEX "Backlink_lost_idx" ON "Backlink"("lost");

-- CreateIndex
CREATE UNIQUE INDEX "Backlink_sourceUrl_targetContentId_key" ON "Backlink"("sourceUrl", "targetContentId");

-- CreateIndex
CREATE INDEX "DomainAuthority_date_idx" ON "DomainAuthority"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DomainAuthority_domain_date_key" ON "DomainAuthority"("domain", "date");

-- CreateIndex
CREATE INDEX "PageExperience_date_idx" ON "PageExperience"("date");

-- CreateIndex
CREATE INDEX "PageExperience_contentItemId_device_idx" ON "PageExperience"("contentItemId", "device");

-- CreateIndex
CREATE UNIQUE INDEX "PageExperience_contentItemId_date_device_source_key" ON "PageExperience"("contentItemId", "date", "device", "source");

-- CreateIndex
CREATE INDEX "ProductionCost_contentItemId_kind_idx" ON "ProductionCost"("contentItemId", "kind");

-- CreateIndex
CREATE INDEX "ProductionCost_producedAt_idx" ON "ProductionCost"("producedAt");

-- CreateIndex
CREATE INDEX "ContentLifecycle_contentItemId_decidedAt_idx" ON "ContentLifecycle"("contentItemId", "decidedAt");

-- CreateIndex
CREATE INDEX "ContentLifecycle_action_idx" ON "ContentLifecycle"("action");

-- CreateIndex
CREATE UNIQUE INDEX "UrlRedirect_fromPath_key" ON "UrlRedirect"("fromPath");

-- CreateIndex
CREATE INDEX "UrlRedirect_toPath_idx" ON "UrlRedirect"("toPath");

-- CreateIndex
CREATE INDEX "SplitTest_state_endsAt_idx" ON "SplitTest"("state", "endsAt");

-- CreateIndex
CREATE INDEX "SplitAssignment_splitTestId_arm_idx" ON "SplitAssignment"("splitTestId", "arm");

-- CreateIndex
CREATE INDEX "SplitAssignment_stratum_idx" ON "SplitAssignment"("stratum");

-- CreateIndex
CREATE UNIQUE INDEX "SplitAssignment_splitTestId_contentItemId_key" ON "SplitAssignment"("splitTestId", "contentItemId");

-- CreateIndex
CREATE INDEX "Experimentation_targetType_targetId_idx" ON "Experimentation"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "Experimentation_state_idx" ON "Experimentation"("state");

-- CreateIndex
CREATE UNIQUE INDEX "Variant_experimentationId_key_key" ON "Variant"("experimentationId", "key");

-- CreateIndex
CREATE INDEX "SeasonalityIndex_month_idx" ON "SeasonalityIndex"("month");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonalityIndex_clusterId_keywordId_month_key" ON "SeasonalityIndex"("clusterId", "keywordId", "month");

-- CreateIndex
CREATE INDEX "RegulatoryEvent_scheduledAt_status_idx" ON "RegulatoryEvent"("scheduledAt", "status");

-- CreateIndex
CREATE INDEX "RegulatoryEvent_eventType_idx" ON "RegulatoryEvent"("eventType");

-- CreateIndex
CREATE INDEX "SnsAccountHealth_date_idx" ON "SnsAccountHealth"("date");

-- CreateIndex
CREATE UNIQUE INDEX "SnsAccountHealth_channelId_date_key" ON "SnsAccountHealth"("channelId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PostSchedule_channelId_hourOfDay_dayOfWeek_key" ON "PostSchedule"("channelId", "hourOfDay", "dayOfWeek");

-- CreateIndex
CREATE UNIQUE INDEX "CrossPromotion_contentItemId_postContentItemId_direction_key" ON "CrossPromotion"("contentItemId", "postContentItemId", "direction");

-- CreateIndex
CREATE INDEX "LandingPage_status_idx" ON "LandingPage"("status");

-- CreateIndex
CREATE INDEX "LandingPage_lpType_idx" ON "LandingPage"("lpType");

-- CreateIndex
CREATE UNIQUE INDEX "LandingPage_businessId_slug_key" ON "LandingPage"("businessId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "LpVersion_landingPageId_versionNo_key" ON "LpVersion"("landingPageId", "versionNo");

-- CreateIndex
CREATE INDEX "LinkCheck_ok_tier_idx" ON "LinkCheck"("ok", "tier");

-- CreateIndex
CREATE INDEX "LinkCheck_contentItemId_idx" ON "LinkCheck"("contentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "LinkCheck_contentItemId_url_checkedAt_key" ON "LinkCheck"("contentItemId", "url", "checkedAt");

-- CreateIndex
CREATE INDEX "UptimeCheck_target_checkedAt_idx" ON "UptimeCheck"("target", "checkedAt");

-- CreateIndex
CREATE INDEX "UptimeCheck_ok_idx" ON "UptimeCheck"("ok");

-- CreateIndex
CREATE INDEX "GenerationProvenance_contentItemId_generatedAt_idx" ON "GenerationProvenance"("contentItemId", "generatedAt");

-- CreateIndex
CREATE INDEX "GenerationProvenance_skillName_skillVersion_idx" ON "GenerationProvenance"("skillName", "skillVersion");

-- CreateIndex
CREATE INDEX "BrandMention_sentiment_handled_idx" ON "BrandMention"("sentiment", "handled");

-- CreateIndex
CREATE INDEX "BrandMention_foundAt_idx" ON "BrandMention"("foundAt");

-- CreateIndex
CREATE INDEX "BrandMention_entity_idx" ON "BrandMention"("entity");

-- CreateIndex
CREATE INDEX "TelemetryVolume_anomaly_idx" ON "TelemetryVolume"("anomaly");

-- CreateIndex
CREATE UNIQUE INDEX "TelemetryVolume_date_hour_key" ON "TelemetryVolume"("date", "hour");

-- CreateIndex
CREATE INDEX "PerfGate_measuredAt_idx" ON "PerfGate"("measuredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PerfGate_releaseTag_target_phase_key" ON "PerfGate"("releaseTag", "target", "phase");

-- CreateIndex
CREATE INDEX "Incident_occurredAt_idx" ON "Incident"("occurredAt");

-- CreateIndex
CREATE INDEX "Incident_severity_category_idx" ON "Incident"("severity", "category");

-- CreateIndex
CREATE UNIQUE INDEX "PostPattern_name_key" ON "PostPattern"("name");

-- CreateIndex
CREATE INDEX "MonitorRun_runAt_passed_idx" ON "MonitorRun"("runAt", "passed");

-- CreateIndex
CREATE INDEX "MonitorRun_scenario_idx" ON "MonitorRun"("scenario");

-- CreateIndex
CREATE INDEX "DataQualityCheck_checkedAt_kind_idx" ON "DataQualityCheck"("checkedAt", "kind");

-- CreateIndex
CREATE INDEX "DataQualityCheck_verdict_idx" ON "DataQualityCheck"("verdict");

-- CreateIndex
CREATE INDEX "ConsentRecord_leadId_idx" ON "ConsentRecord"("leadId");

-- CreateIndex
CREATE INDEX "ConsentRecord_visitorId_idx" ON "ConsentRecord"("visitorId");

-- CreateIndex
CREATE UNIQUE INDEX "DataRetentionPolicy_entity_key" ON "DataRetentionPolicy"("entity");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_at_idx" ON "AuditLog"("entity", "entityId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_actorType_at_idx" ON "AuditLog"("actorType", "at");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "ContentVersion_contentItemId_capturedAt_idx" ON "ContentVersion"("contentItemId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContentVersion_contentItemId_versionNo_key" ON "ContentVersion"("contentItemId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Target" ADD CONSTRAINT "Target_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshot" ADD CONSTRAINT "MetricSnapshot_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasurementCoverage" ADD CONSTRAINT "MeasurementCoverage_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentItem" ADD CONSTRAINT "ContentItem_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleReview" ADD CONSTRAINT "ArticleReview_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticleReview" ADD CONSTRAINT "ArticleReview_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "Intervention"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentMetric" ADD CONSTRAINT "ContentMetric_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cta" ADD CONSTRAINT "Cta_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorSession" ADD CONSTRAINT "VisitorSession_landingContentId_fkey" FOREIGN KEY ("landingContentId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelEvent" ADD CONSTRAINT "FunnelEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelEvent" ADD CONSTRAINT "FunnelEvent_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelEvent" ADD CONSTRAINT "FunnelEvent_ctaId_fkey" FOREIGN KEY ("ctaId") REFERENCES "Cta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelEvent" ADD CONSTRAINT "FunnelEvent_lpId_fkey" FOREIGN KEY ("lpId") REFERENCES "LandingPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_firstTouchContentId_fkey" FOREIGN KEY ("firstTouchContentId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_lastTouchContentId_fkey" FOREIGN KEY ("lastTouchContentId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sourceKeywordId_fkey" FOREIGN KEY ("sourceKeywordId") REFERENCES "Keyword"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sourceChannelId_fkey" FOREIGN KEY ("sourceChannelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "VisitorSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyLead" ADD CONSTRAINT "AgencyLead_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_parentPartnerId_fkey" FOREIGN KEY ("parentPartnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineFriend" ADD CONSTRAINT "LineFriend_sourceContentId_fkey" FOREIGN KEY ("sourceContentId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LineFriend" ADD CONSTRAINT "LineFriend_convertedLeadId_fkey" FOREIGN KEY ("convertedLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_keywordClusterId_fkey" FOREIGN KEY ("keywordClusterId") REFERENCES "KeywordCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordResearch" ADD CONSTRAINT "KeywordResearch_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordAssignment" ADD CONSTRAINT "KeywordAssignment_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordAssignment" ADD CONSTRAINT "KeywordAssignment_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordRanking" ADD CONSTRAINT "KeywordRanking_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicCluster" ADD CONSTRAINT "TopicCluster_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicCluster" ADD CONSTRAINT "TopicCluster_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TopicCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicCluster" ADD CONSTRAINT "TopicCluster_pillarContentId_fkey" FOREIGN KEY ("pillarContentId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicCluster" ADD CONSTRAINT "TopicCluster_targetKeywordId_fkey" FOREIGN KEY ("targetKeywordId") REFERENCES "Keyword"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCluster" ADD CONSTRAINT "ContentCluster_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentCluster" ADD CONSTRAINT "ContentCluster_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "TopicCluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalLink" ADD CONSTRAINT "InternalLink_srcContentId_fkey" FOREIGN KEY ("srcContentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InternalLink" ADD CONSTRAINT "InternalLink_dstContentId_fkey" FOREIGN KEY ("dstContentId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterMetric" ADD CONSTRAINT "ClusterMetric_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "TopicCluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordVolume" ADD CONSTRAINT "KeywordVolume_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordCluster" ADD CONSTRAINT "KeywordCluster_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SerpSnapshot" ADD CONSTRAINT "SerpSnapshot_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorMetric" ADD CONSTRAINT "CompetitorMetric_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketShare" ADD CONSTRAINT "MarketShare_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "KeywordCluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdAccount" ADD CONSTRAINT "AdAccount_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCampaign" ADD CONSTRAINT "AdCampaign_targetLpId_fkey" FOREIGN KEY ("targetLpId") REFERENCES "LandingPage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdGroup" ADD CONSTRAINT "AdGroup_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AdCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdCreative" ADD CONSTRAINT "AdCreative_adGroupId_fkey" FOREIGN KEY ("adGroupId") REFERENCES "AdGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdMetricDaily" ADD CONSTRAINT "AdMetricDaily_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "AdCampaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdMetricDaily" ADD CONSTRAINT "AdMetricDaily_adGroupId_fkey" FOREIGN KEY ("adGroupId") REFERENCES "AdGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdMetricDaily" ADD CONSTRAINT "AdMetricDaily_creativeId_fkey" FOREIGN KEY ("creativeId") REFERENCES "AdCreative"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UnitEconomics" ADD CONSTRAINT "UnitEconomics_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSimulation" ADD CONSTRAINT "AdSimulation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSimulation" ADD CONSTRAINT "AdSimulation_actualLinkedCampaignId_fkey" FOREIGN KEY ("actualLinkedCampaignId") REFERENCES "AdCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Action" ADD CONSTRAINT "Action_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionEvent" ADD CONSTRAINT "ActionEvent_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_actionId_fkey" FOREIGN KEY ("actionId") REFERENCES "Action"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_beforeVersionId_fkey" FOREIGN KEY ("beforeVersionId") REFERENCES "ContentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_afterVersionId_fkey" FOREIGN KEY ("afterVersionId") REFERENCES "ContentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Learning" ADD CONSTRAINT "Learning_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Learning" ADD CONSTRAINT "Learning_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Learning" ADD CONSTRAINT "Learning_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "Intervention"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IndexStatus" ADD CONSTRAINT "IndexStatus_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTouchpoint" ADD CONSTRAINT "LeadTouchpoint_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadTouchpoint" ADD CONSTRAINT "LeadTouchpoint_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Backlink" ADD CONSTRAINT "Backlink_targetContentId_fkey" FOREIGN KEY ("targetContentId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DomainAuthority" ADD CONSTRAINT "DomainAuthority_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PageExperience" ADD CONSTRAINT "PageExperience_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductionCost" ADD CONSTRAINT "ProductionCost_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentLifecycle" ADD CONSTRAINT "ContentLifecycle_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentLifecycle" ADD CONSTRAINT "ContentLifecycle_mergeTargetId_fkey" FOREIGN KEY ("mergeTargetId") REFERENCES "ContentItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SplitAssignment" ADD CONSTRAINT "SplitAssignment_splitTestId_fkey" FOREIGN KEY ("splitTestId") REFERENCES "SplitTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SplitAssignment" ADD CONSTRAINT "SplitAssignment_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Variant" ADD CONSTRAINT "Variant_experimentationId_fkey" FOREIGN KEY ("experimentationId") REFERENCES "Experimentation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonalityIndex" ADD CONSTRAINT "SeasonalityIndex_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "KeywordCluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonalityIndex" ADD CONSTRAINT "SeasonalityIndex_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SnsAccountHealth" ADD CONSTRAINT "SnsAccountHealth_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostSchedule" ADD CONSTRAINT "PostSchedule_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossPromotion" ADD CONSTRAINT "CrossPromotion_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrossPromotion" ADD CONSTRAINT "CrossPromotion_postContentItemId_fkey" FOREIGN KEY ("postContentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LandingPage" ADD CONSTRAINT "LandingPage_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LpVersion" ADD CONSTRAINT "LpVersion_landingPageId_fkey" FOREIGN KEY ("landingPageId") REFERENCES "LandingPage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkCheck" ADD CONSTRAINT "LinkCheck_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationProvenance" ADD CONSTRAINT "GenerationProvenance_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentVersion" ADD CONSTRAINT "ContentVersion_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "ContentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
