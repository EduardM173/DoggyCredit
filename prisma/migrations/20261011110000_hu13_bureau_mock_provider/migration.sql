-- Insert BUREAU_MOCK into IntegrationProvider for HU-13 multi-source evaluations
INSERT INTO "IntegrationProvider" ("id", "code", "name", "kind", "status", "createdAt", "updatedAt")
VALUES (gen_random_uuid(), 'BUREAU_MOCK', 'Buró crediticio simulado', 'CREDIT_BUREAU', 'ACTIVE', now(), now())
ON CONFLICT ("code") DO NOTHING;
