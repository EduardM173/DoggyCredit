ALTER TABLE "Tenant"
  ADD COLUMN "informationConfirmedAt" TIMESTAMPTZ(6),
  ADD COLUMN "productsConfirmedAt" TIMESTAMPTZ(6);

INSERT INTO "IntegrationProvider" ("id", "code", "name", "kind", "status", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'BANK_MOCK', 'Fuente bancaria simulada', 'BANK', 'ACTIVE', now(), now())
ON CONFLICT ("code") DO NOTHING;
