-- HU-30: habilitación global del proveedor, separada de su salud observada (status)
-- y de la habilitación por institución (TenantIntegration.enabled).
ALTER TABLE "IntegrationProvider"
  ADD COLUMN "globallyEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "globalChangedAt" TIMESTAMPTZ(6);
