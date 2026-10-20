DROP INDEX "Evaluation_idempotencyKey_key";
CREATE UNIQUE INDEX "Evaluation_tenantId_idempotencyKey_key"
  ON "Evaluation"("tenantId", "idempotencyKey");

DROP INDEX "UsageRecord_idempotencyKey_key";
CREATE UNIQUE INDEX "UsageRecord_tenantId_idempotencyKey_key"
  ON "UsageRecord"("tenantId", "idempotencyKey");

INSERT INTO "UsageRecord" (
  "tenantId",
  "metric",
  "quantity",
  "referenceType",
  "referenceId",
  "idempotencyKey",
  "occurredAt"
)
SELECT
  "tenantId",
  'EVALUATION'::"UsageMetric",
  1,
  'Evaluation',
  "id",
  'evaluation-completed/' || "id",
  COALESCE("completedAt", "updatedAt")
FROM "Evaluation"
WHERE "status" = 'COMPLETED'::"EvaluationStatus"
ON CONFLICT ("tenantId", "idempotencyKey") DO NOTHING;
