-- HU-25: idempotencia por tenant, lease de ejecución y tope de reconsultas.
ALTER TABLE "Evaluation" ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Evaluation" ADD COLUMN IF NOT EXISTS "lastRetryAt" TIMESTAMPTZ(6);
ALTER TABLE "Evaluation" ADD COLUMN IF NOT EXISTS "leaseToken" UUID;
ALTER TABLE "Evaluation" ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMPTZ(6);
ALTER TABLE "Evaluation" ADD COLUMN IF NOT EXISTS "heartbeatAt" TIMESTAMPTZ(6);

DROP INDEX IF EXISTS "Evaluation_idempotencyKey_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Evaluation_tenantId_idempotencyKey_key" ON "Evaluation"("tenantId", "idempotencyKey");
CREATE INDEX IF NOT EXISTS "Evaluation_status_leaseExpiresAt_idx" ON "Evaluation"("status", "leaseExpiresAt");
