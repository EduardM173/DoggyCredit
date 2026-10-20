-- HU-25 · aditiva y no destructiva
ALTER TABLE "Evaluation" ADD COLUMN IF NOT EXISTS "requestFingerprint" VARCHAR(64);
-- Verifica antes de aplicar: retryCount, leaseToken, leaseExpiresAt, heartbeatAt, lastRetryAt
-- ya deben existir (si tu schema.prisma los tenía, existe una migración previa).
