-- CreateEnum
CREATE TYPE "ProvisioningStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_PERMANENT');

-- AlterTable
ALTER TABLE "MembershipInvitation" ADD COLUMN     "invalidatedAt" TIMESTAMPTZ(6),
ADD COLUMN     "lastSendAttemptAt" TIMESTAMPTZ(6),
ADD COLUMN     "lastSendErrorCode" VARCHAR(60),
ADD COLUMN     "nextSendAttemptAt" TIMESTAMPTZ(6),
ADD COLUMN     "sendAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sendLeaseToken" UUID,
ADD COLUMN     "sendLockedAt" TIMESTAMPTZ(6),
ADD COLUMN     "sentAt" TIMESTAMPTZ(6),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "TenantMembership" ADD COLUMN     "isInitialAdmin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TenantSubscription" ADD COLUMN     "sourceContractingId" UUID;

-- CreateTable
CREATE TABLE "TenantProvisioning" (
    "id" UUID NOT NULL,
    "contractingId" UUID NOT NULL,
    "institutionRequestId" UUID NOT NULL,
    "status" "ProvisioningStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(6),
    "lockedAt" TIMESTAMPTZ(6),
    "leaseToken" UUID,
    "completedAt" TIMESTAMPTZ(6),
    "tenantId" UUID,
    "lastErrorCode" VARCHAR(60),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TenantProvisioning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantProvisioning_contractingId_key" ON "TenantProvisioning"("contractingId");

-- CreateIndex
CREATE UNIQUE INDEX "TenantProvisioning_tenantId_key" ON "TenantProvisioning"("tenantId");

-- CreateIndex
CREATE INDEX "TenantProvisioning_status_nextAttemptAt_lockedAt_idx" ON "TenantProvisioning"("status", "nextAttemptAt", "lockedAt");

-- CreateIndex
CREATE INDEX "MembershipInvitation_sentAt_nextSendAttemptAt_sendLockedAt_idx" ON "MembershipInvitation"("sentAt", "nextSendAttemptAt", "sendLockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TenantSubscription_sourceContractingId_key" ON "TenantSubscription"("sourceContractingId");

-- AddForeignKey
ALTER TABLE "TenantProvisioning" ADD CONSTRAINT "TenantProvisioning_contractingId_fkey" FOREIGN KEY ("contractingId") REFERENCES "Contracting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantProvisioning" ADD CONSTRAINT "TenantProvisioning_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_sourceContractingId_fkey" FOREIGN KEY ("sourceContractingId") REFERENCES "Contracting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Database invariants for concurrent provisioning.
CREATE UNIQUE INDEX "TenantMembership_initial_admin_key" ON "TenantMembership" ("tenantId") WHERE "isInitialAdmin" = true;
ALTER TABLE "TenantMembership" ADD CONSTRAINT "TenantMembership_initial_admin_role_check" CHECK (NOT "isInitialAdmin" OR role = 'INSTITUTION_ADMIN');
CREATE UNIQUE INDEX "TenantSubscription_one_active_key" ON "TenantSubscription" ("tenantId") WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX "MembershipInvitation_one_current_key" ON "MembershipInvitation" ("membershipId") WHERE "acceptedAt" IS NULL AND "invalidatedAt" IS NULL;
CREATE UNIQUE INDEX "User_email_case_insensitive_key" ON "User" (lower(email));

-- Recover contracts confirmed before HU-05 without changing their commercial state.
INSERT INTO "TenantProvisioning" (id, "contractingId", "institutionRequestId", "updatedAt")
SELECT gen_random_uuid(), id, "requestId", CURRENT_TIMESTAMP FROM "Contracting"
WHERE status = 'CONFIRMED' ON CONFLICT ("contractingId") DO NOTHING;
