-- CreateEnum
CREATE TYPE "InstitutionType" AS ENUM ('BANK', 'FINANCIAL_INSTITUTION', 'COOPERATIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "InstitutionRequestStatus" AS ENUM ('EMAIL_PENDING', 'PENDING_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('PLATFORM_ADMIN', 'OPERATOR');

-- CreateEnum
CREATE TYPE "TenantRole" AS ENUM ('INSTITUTION_ADMIN', 'ANALYST');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'ENDED');

-- CreateEnum
CREATE TYPE "ClientType" AS ENUM ('PERSON', 'COMPANY');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('CI', 'NIT', 'PASSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "CreditPurpose" AS ENUM ('WORKING_CAPITAL', 'GREEN_PROJECT', 'BUSINESS_INVESTMENT', 'EQUIPMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('MICRO_CREDIT', 'GREEN_CREDIT', 'SME_CREDIT', 'OTHER');

-- CreateEnum
CREATE TYPE "ApplicantScope" AS ENUM ('PERSON', 'COMPANY', 'BOTH');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'INCOMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "IntegrationKind" AS ENUM ('BANK', 'CREDIT_BUREAU', 'FINTECH');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('ACTIVE', 'DEGRADED', 'INACTIVE');

-- CreateEnum
CREATE TYPE "SourceResultStatus" AS ENUM ('SUCCESS', 'NO_DATA', 'UNAVAILABLE', 'ERROR');

-- CreateEnum
CREATE TYPE "RecommendationOutcome" AS ENUM ('RECOMMENDED', 'NOT_COMPATIBLE');

-- CreateEnum
CREATE TYPE "UsageMetric" AS ENUM ('EVALUATION', 'SCORING');

-- CreateTable
CREATE TABLE "Plan" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "evaluationsPerMonth" INTEGER,
    "maxUsers" INTEGER,
    "scoringEnabled" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstitutionRequest" (
    "id" UUID NOT NULL,
    "institutionName" VARCHAR(180) NOT NULL,
    "taxId" VARCHAR(40) NOT NULL,
    "institutionType" "InstitutionType" NOT NULL,
    "contactName" VARCHAR(140) NOT NULL,
    "contactRole" VARCHAR(120) NOT NULL,
    "contactEmail" VARCHAR(254) NOT NULL,
    "contactPhone" VARCHAR(40),
    "requestedPlanId" UUID,
    "status" "InstitutionRequestStatus" NOT NULL DEFAULT 'EMAIL_PENDING',
    "emailVerifiedAt" TIMESTAMPTZ(6),
    "reviewedAt" TIMESTAMPTZ(6),
    "reviewedById" UUID,
    "rejectionReason" VARCHAR(500),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "InstitutionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailVerificationToken" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailVerificationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "fullName" VARCHAR(160) NOT NULL,
    "passwordHash" VARCHAR(255),
    "status" "UserStatus" NOT NULL DEFAULT 'INVITED',
    "platformRole" "PlatformRole",
    "emailVerifiedAt" TIMESTAMPTZ(6),
    "lastLoginAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tenant" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "legalName" VARCHAR(180) NOT NULL,
    "taxId" VARCHAR(40) NOT NULL,
    "institutionType" "InstitutionType" NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdFromRequestId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantMembership" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "TenantRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'INVITED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TenantMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipInvitation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "membershipId" UUID NOT NULL,
    "tokenHash" VARCHAR(128) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "acceptedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantSubscription" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TenantSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationProvider" (
    "id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(140) NOT NULL,
    "kind" "IntegrationKind" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "IntegrationProvider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TenantIntegration" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastHealthAt" TIMESTAMPTZ(6),
    "lastErrorCode" VARCHAR(100),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TenantIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialProduct" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "applicantScope" "ApplicantScope" NOT NULL,
    "minAmount" DECIMAL(14,2) NOT NULL,
    "maxAmount" DECIMAL(14,2) NOT NULL,
    "maxDebtToIncome" DECIMAL(6,4),
    "minMonthlyDisposableIncome" DECIMAL(14,2),
    "allowsRecentArrears" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "FinancialProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialProductPurpose" (
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "purpose" "CreditPurpose" NOT NULL,

    CONSTRAINT "FinancialProductPurpose_pkey" PRIMARY KEY ("tenantId","productId","purpose")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" "ClientType" NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "documentNumber" VARCHAR(60) NOT NULL,
    "name" VARCHAR(180) NOT NULL,
    "email" VARCHAR(254),
    "phone" VARCHAR(40),
    "address" VARCHAR(250),
    "economicActivity" VARCHAR(180),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evaluation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "createdByMembershipId" UUID NOT NULL,
    "idempotencyKey" VARCHAR(80) NOT NULL,
    "purpose" "CreditPurpose" NOT NULL,
    "requestedAmount" DECIMAL(14,2) NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'DRAFT',
    "consentGivenAt" TIMESTAMPTZ(6),
    "applicantSnapshot" JSONB NOT NULL,
    "startedAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "failureCode" VARCHAR(100),
    "failureMessage" VARCHAR(500),
    "ruleVersion" VARCHAR(60),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationSourceResult" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "providerId" UUID NOT NULL,
    "status" "SourceResultStatus" NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "externalReference" VARCHAR(120),
    "errorCode" VARCHAR(100),
    "normalizedPayload" JSONB,
    "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationSourceResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialProfile" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "averageMonthlyIncome" DECIMAL(14,2),
    "averageMonthlyExpenses" DECIMAL(14,2),
    "disposableIncome" DECIMAL(14,2),
    "totalDebt" DECIMAL(14,2),
    "activeCredits" INTEGER,
    "debtToIncome" DECIMAL(6,4),
    "hasRecentArrears" BOOLEAN,
    "completeness" DECIMAL(5,4) NOT NULL DEFAULT 0,
    "profileVersion" VARCHAR(60) NOT NULL,
    "calculatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileSource" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "sourceResultId" UUID NOT NULL,

    CONSTRAINT "ProfileSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationRecommendation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "evaluationId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "outcome" "RecommendationOutcome" NOT NULL,
    "ruleVersion" VARCHAR(60) NOT NULL,
    "evaluatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationReason" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "recommendationId" UUID NOT NULL,
    "code" VARCHAR(80) NOT NULL,
    "message" VARCHAR(300) NOT NULL,
    "passed" BOOLEAN NOT NULL,

    CONSTRAINT "RecommendationReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageRecord" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "metric" "UsageMetric" NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "referenceType" VARCHAR(60),
    "referenceId" VARCHAR(80),
    "idempotencyKey" VARCHAR(100) NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "actorUserId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entityType" VARCHAR(80) NOT NULL,
    "entityId" VARCHAR(80),
    "metadata" JSONB,
    "ipAddress" VARCHAR(64),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE INDEX "InstitutionRequest_status_createdAt_idx" ON "InstitutionRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "InstitutionRequest_taxId_idx" ON "InstitutionRequest"("taxId");

-- CreateIndex
CREATE INDEX "InstitutionRequest_contactEmail_idx" ON "InstitutionRequest"("contactEmail");

-- CreateIndex
CREATE UNIQUE INDEX "EmailVerificationToken_tokenHash_key" ON "EmailVerificationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailVerificationToken_requestId_expiresAt_idx" ON "EmailVerificationToken"("requestId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_taxId_key" ON "Tenant"("taxId");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_createdFromRequestId_key" ON "Tenant"("createdFromRequestId");

-- CreateIndex
CREATE INDEX "TenantMembership_userId_status_idx" ON "TenantMembership"("userId", "status");

-- CreateIndex
CREATE INDEX "TenantMembership_tenantId_role_status_idx" ON "TenantMembership"("tenantId", "role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMembership_tenantId_userId_key" ON "TenantMembership"("tenantId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantMembership_tenantId_id_key" ON "TenantMembership"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipInvitation_tokenHash_key" ON "MembershipInvitation"("tokenHash");

-- CreateIndex
CREATE INDEX "MembershipInvitation_tenantId_membershipId_expiresAt_idx" ON "MembershipInvitation"("tenantId", "membershipId", "expiresAt");

-- CreateIndex
CREATE INDEX "TenantSubscription_tenantId_status_idx" ON "TenantSubscription"("tenantId", "status");

-- CreateIndex
CREATE INDEX "TenantSubscription_planId_status_idx" ON "TenantSubscription"("planId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IntegrationProvider_code_key" ON "IntegrationProvider"("code");

-- CreateIndex
CREATE INDEX "TenantIntegration_tenantId_enabled_status_idx" ON "TenantIntegration"("tenantId", "enabled", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TenantIntegration_tenantId_providerId_key" ON "TenantIntegration"("tenantId", "providerId");

-- CreateIndex
CREATE INDEX "FinancialProduct_tenantId_active_category_idx" ON "FinancialProduct"("tenantId", "active", "category");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProduct_tenantId_id_key" ON "FinancialProduct"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProduct_tenantId_name_key" ON "FinancialProduct"("tenantId", "name");

-- CreateIndex
CREATE INDEX "FinancialProductPurpose_tenantId_purpose_idx" ON "FinancialProductPurpose"("tenantId", "purpose");

-- CreateIndex
CREATE INDEX "Client_tenantId_name_idx" ON "Client"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Client_tenantId_createdAt_idx" ON "Client"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Client_tenantId_documentType_documentNumber_key" ON "Client"("tenantId", "documentType", "documentNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Client_tenantId_id_key" ON "Client"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_idempotencyKey_key" ON "Evaluation"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Evaluation_tenantId_status_createdAt_idx" ON "Evaluation"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Evaluation_tenantId_clientId_createdAt_idx" ON "Evaluation"("tenantId", "clientId", "createdAt");

-- CreateIndex
CREATE INDEX "Evaluation_tenantId_createdByMembershipId_createdAt_idx" ON "Evaluation"("tenantId", "createdByMembershipId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Evaluation_tenantId_id_key" ON "Evaluation"("tenantId", "id");

-- CreateIndex
CREATE INDEX "EvaluationSourceResult_tenantId_evaluationId_providerId_idx" ON "EvaluationSourceResult"("tenantId", "evaluationId", "providerId");

-- CreateIndex
CREATE INDEX "EvaluationSourceResult_tenantId_status_requestedAt_idx" ON "EvaluationSourceResult"("tenantId", "status", "requestedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationSourceResult_tenantId_id_key" ON "EvaluationSourceResult"("tenantId", "id");

-- CreateIndex
CREATE INDEX "FinancialProfile_tenantId_calculatedAt_idx" ON "FinancialProfile"("tenantId", "calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProfile_tenantId_id_key" ON "FinancialProfile"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProfile_tenantId_evaluationId_key" ON "FinancialProfile"("tenantId", "evaluationId");

-- CreateIndex
CREATE INDEX "ProfileSource_tenantId_sourceResultId_idx" ON "ProfileSource"("tenantId", "sourceResultId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileSource_tenantId_profileId_sourceResultId_key" ON "ProfileSource"("tenantId", "profileId", "sourceResultId");

-- CreateIndex
CREATE INDEX "EvaluationRecommendation_tenantId_evaluationId_outcome_idx" ON "EvaluationRecommendation"("tenantId", "evaluationId", "outcome");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationRecommendation_tenantId_id_key" ON "EvaluationRecommendation"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "EvaluationRecommendation_tenantId_evaluationId_productId_key" ON "EvaluationRecommendation"("tenantId", "evaluationId", "productId");

-- CreateIndex
CREATE INDEX "RecommendationReason_tenantId_recommendationId_idx" ON "RecommendationReason"("tenantId", "recommendationId");

-- CreateIndex
CREATE UNIQUE INDEX "UsageRecord_idempotencyKey_key" ON "UsageRecord"("idempotencyKey");

-- CreateIndex
CREATE INDEX "UsageRecord_tenantId_metric_occurredAt_idx" ON "UsageRecord"("tenantId", "metric", "occurredAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "InstitutionRequest" ADD CONSTRAINT "InstitutionRequest_requestedPlanId_fkey" FOREIGN KEY ("requestedPlanId") REFERENCES "Plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstitutionRequest" ADD CONSTRAINT "InstitutionRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailVerificationToken" ADD CONSTRAINT "EmailVerificationToken_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "InstitutionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_createdFromRequestId_fkey" FOREIGN KEY ("createdFromRequestId") REFERENCES "InstitutionRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipInvitation" ADD CONSTRAINT "MembershipInvitation_tenantId_membershipId_fkey" FOREIGN KEY ("tenantId", "membershipId") REFERENCES "TenantMembership"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantIntegration" ADD CONSTRAINT "TenantIntegration_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantIntegration" ADD CONSTRAINT "TenantIntegration_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "IntegrationProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProduct" ADD CONSTRAINT "FinancialProduct_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProductPurpose" ADD CONSTRAINT "FinancialProductPurpose_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "FinancialProduct"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_tenantId_clientId_fkey" FOREIGN KEY ("tenantId", "clientId") REFERENCES "Client"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evaluation" ADD CONSTRAINT "Evaluation_tenantId_createdByMembershipId_fkey" FOREIGN KEY ("tenantId", "createdByMembershipId") REFERENCES "TenantMembership"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationSourceResult" ADD CONSTRAINT "EvaluationSourceResult_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationSourceResult" ADD CONSTRAINT "EvaluationSourceResult_tenantId_evaluationId_fkey" FOREIGN KEY ("tenantId", "evaluationId") REFERENCES "Evaluation"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationSourceResult" ADD CONSTRAINT "EvaluationSourceResult_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "IntegrationProvider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProfile" ADD CONSTRAINT "FinancialProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProfile" ADD CONSTRAINT "FinancialProfile_tenantId_evaluationId_fkey" FOREIGN KEY ("tenantId", "evaluationId") REFERENCES "Evaluation"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileSource" ADD CONSTRAINT "ProfileSource_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileSource" ADD CONSTRAINT "ProfileSource_tenantId_profileId_fkey" FOREIGN KEY ("tenantId", "profileId") REFERENCES "FinancialProfile"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileSource" ADD CONSTRAINT "ProfileSource_tenantId_sourceResultId_fkey" FOREIGN KEY ("tenantId", "sourceResultId") REFERENCES "EvaluationSourceResult"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRecommendation" ADD CONSTRAINT "EvaluationRecommendation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRecommendation" ADD CONSTRAINT "EvaluationRecommendation_tenantId_evaluationId_fkey" FOREIGN KEY ("tenantId", "evaluationId") REFERENCES "Evaluation"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationRecommendation" ADD CONSTRAINT "EvaluationRecommendation_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "FinancialProduct"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationReason" ADD CONSTRAINT "RecommendationReason_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationReason" ADD CONSTRAINT "RecommendationReason_tenantId_recommendationId_fkey" FOREIGN KEY ("tenantId", "recommendationId") REFERENCES "EvaluationRecommendation"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageRecord" ADD CONSTRAINT "UsageRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
