CREATE TABLE "RequestDecisionNotice" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "sentAt" TIMESTAMPTZ(6),
    "sendAttempts" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "nextSendAttemptAt" TIMESTAMPTZ(6),
    "sendLockedAt" TIMESTAMPTZ(6),
    "sendLeaseToken" UUID,
    "lastSendErrorCode" VARCHAR(60),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RequestDecisionNotice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "RequestDecisionNotice_requestId_key" ON "RequestDecisionNotice"("requestId");
CREATE INDEX "RequestDecisionNotice_sentAt_nextSendAttemptAt_sendLockedAt_idx" ON "RequestDecisionNotice"("sentAt", "nextSendAttemptAt", "sendLockedAt");
ALTER TABLE "RequestDecisionNotice" ADD CONSTRAINT "RequestDecisionNotice_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "InstitutionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
