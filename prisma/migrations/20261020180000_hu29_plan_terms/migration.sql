CREATE TYPE "EvaluationLimitMode" AS ENUM ('NO_CONFIGURADO', 'LIMITADO', 'ILIMITADO');

ALTER TABLE "Plan" ADD COLUMN "evaluationLimitMode" "EvaluationLimitMode" NOT NULL DEFAULT 'NO_CONFIGURADO';
ALTER TABLE "Plan" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Plan" ADD COLUMN "effectiveFrom" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;
UPDATE "Plan" SET "evaluationLimitMode" = 'LIMITADO' WHERE "evaluationsPerMonth" IS NOT NULL;

ALTER TABLE "Contracting" ADD COLUMN "termsSnapshot" JSONB;
ALTER TABLE "TenantSubscription" ADD COLUMN "termsSnapshot" JSONB;

UPDATE "Contracting" c SET "termsSnapshot" = jsonb_build_object(
  'planId', c."confirmedPlanId", 'revision', 1, 'code', c."planCodeSnapshot",
  'name', c."planNameSnapshot", 'price', c."priceSnapshot"::text,
  'currency', c."currencySnapshot", 'billingPeriod', c."billingPeriodSnapshot",
  'requiresPayment', c."requiresPaymentSnapshot", 'features', to_jsonb(p."features"),
  'evaluationLimitMode', p."evaluationLimitMode"::text,
  'evaluationsPerMonth', p."evaluationsPerMonth", 'maxUsers', p."maxUsers",
  'scoringEnabled', p."scoringEnabled", 'legacyBaseline', true
) FROM "Plan" p WHERE p."id" = c."confirmedPlanId";

UPDATE "TenantSubscription" s SET "termsSnapshot" = COALESCE(
  (SELECT c."termsSnapshot" FROM "Contracting" c WHERE c."id" = s."sourceContractingId"),
  jsonb_build_object(
  'planId', p."id", 'revision', 1, 'code', p."code", 'name', p."name",
  'price', COALESCE(p."price"::text, '0.00'), 'currency', COALESCE(p."currency", 'BOB'),
  'billingPeriod', COALESCE(p."billingPeriod", 'MONTHLY'),
  'requiresPayment', COALESCE(p."requiresPayment", false), 'features', to_jsonb(p."features"),
  'evaluationLimitMode', p."evaluationLimitMode"::text,
  'evaluationsPerMonth', p."evaluationsPerMonth", 'maxUsers', p."maxUsers",
  'scoringEnabled', p."scoringEnabled", 'legacyBaseline', true
)) FROM "Plan" p
WHERE p."id" = s."planId";
