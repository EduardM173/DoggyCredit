-- Restricciones recomendadas para PostgreSQL que complementan Prisma.
-- Añádelas a una migración SQL después de la migración inicial.

ALTER TABLE "FinancialProduct"
  ADD CONSTRAINT financial_product_amount_range_chk
  CHECK ("minAmount" >= 0 AND "maxAmount" >= "minAmount");

ALTER TABLE "Evaluation"
  ADD CONSTRAINT evaluation_requested_amount_positive_chk
  CHECK ("requestedAmount" > 0);

ALTER TABLE "FinancialProfile"
  ADD CONSTRAINT financial_profile_completeness_chk
  CHECK ("completeness" >= 0 AND "completeness" <= 1),
  ADD CONSTRAINT financial_profile_dti_chk
  CHECK ("debtToIncome" IS NULL OR "debtToIncome" >= 0);

ALTER TABLE "UsageRecord"
  ADD CONSTRAINT usage_record_quantity_positive_chk
  CHECK ("quantity" > 0);

-- Una sola suscripción activa por tenant.
CREATE UNIQUE INDEX tenant_one_active_subscription_idx
  ON "TenantSubscription" ("tenantId")
  WHERE "status" = 'ACTIVE';

-- Defensa adicional para emails, aunque NestJS debe normalizarlos a minúsculas.
CREATE UNIQUE INDEX user_email_case_insensitive_idx
  ON "User" (lower("email"));
