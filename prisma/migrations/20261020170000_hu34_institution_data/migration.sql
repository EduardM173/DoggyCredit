-- HU-34: datos institucionales editables por el INSTITUTION_ADMIN.
-- Los campos legales (legalName, taxId, slug) y el responsable contractual
-- permanecen bloqueados y no se almacenan aqui.
ALTER TABLE "Tenant"
  ADD COLUMN "publicAddress" VARCHAR(240),
  ADD COLUMN "supportPhone" VARCHAR(40),
  ADD COLUMN "supportEmail" VARCHAR(254),
  ADD COLUMN "contactPhone" VARCHAR(40),
  ADD COLUMN "contactEmail" VARCHAR(254);
