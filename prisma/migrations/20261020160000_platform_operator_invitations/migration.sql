CREATE TYPE "PlatformAccessStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REVOKED');

ALTER TABLE "User" ADD COLUMN "platformAccessStatus" "PlatformAccessStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE "PlatformInvitation" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tokenHash" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "sentAt" TIMESTAMPTZ(6),
  "sendAttemptedAt" TIMESTAMPTZ(6),
  "sendErrorCode" VARCHAR(60),
  "acceptedAt" TIMESTAMPTZ(6),
  "invalidatedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformInvitation_tokenHash_key" ON "PlatformInvitation"("tokenHash");
CREATE INDEX "PlatformInvitation_userId_createdAt_idx" ON "PlatformInvitation"("userId", "createdAt");
ALTER TABLE "PlatformInvitation" ADD CONSTRAINT "PlatformInvitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
