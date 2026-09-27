ALTER TABLE "ContractingCredential"
  ADD COLUMN "deliveryQueuedAt" TIMESTAMPTZ(6),
  ADD COLUMN "sentAt" TIMESTAMPTZ(6),
  ADD COLUMN "sendAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sendVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextSendAttemptAt" TIMESTAMPTZ(6),
  ADD COLUMN "sendLockedAt" TIMESTAMPTZ(6),
  ADD COLUMN "sendLeaseToken" UUID,
  ADD COLUMN "lastSendErrorCode" VARCHAR(60);

CREATE INDEX "ContractingCredential_deliveryQueuedAt_sentAt_nextSendAttemptAt_sendLockedAt_idx"
  ON "ContractingCredential"("deliveryQueuedAt", "sentAt", "nextSendAttemptAt", "sendLockedAt");
