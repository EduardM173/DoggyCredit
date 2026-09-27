CREATE TABLE "InstitutionSession" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstitutionSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "InstitutionSession_tokenHash_key" ON "InstitutionSession"("tokenHash");
CREATE INDEX "InstitutionSession_userId_expiresAt_idx" ON "InstitutionSession"("userId", "expiresAt");
ALTER TABLE "InstitutionSession" ADD CONSTRAINT "InstitutionSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
