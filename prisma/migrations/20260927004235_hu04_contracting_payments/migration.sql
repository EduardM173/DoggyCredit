-- CreateEnum
CREATE TYPE "ContractingStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'QR', 'CARD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContractingCredentialKind" AS ENUM ('ACCESS', 'SESSION');

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "billingPeriod" VARCHAR(20),
ADD COLUMN     "currency" VARCHAR(3),
ADD COLUMN     "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "price" DECIMAL(14,2),
ADD COLUMN     "requiresPayment" BOOLEAN;

-- CreateTable
CREATE TABLE "ContractingCredential" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "kind" "ContractingCredentialKind" NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "usedAt" TIMESTAMPTZ(6),
    "revokedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractingCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contracting" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "confirmedPlanId" UUID NOT NULL,
    "planCodeSnapshot" VARCHAR(50) NOT NULL,
    "planNameSnapshot" VARCHAR(100) NOT NULL,
    "priceSnapshot" DECIMAL(14,2) NOT NULL,
    "currencySnapshot" VARCHAR(3) NOT NULL,
    "billingPeriodSnapshot" VARCHAR(20) NOT NULL,
    "requiresPaymentSnapshot" BOOLEAN NOT NULL,
    "status" "ContractingStatus" NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "confirmedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Contracting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "contractingId" UUID NOT NULL,
    "reference" VARCHAR(80) NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "providerReference" VARCHAR(100),
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    "paidAt" TIMESTAMPTZ(6),
    "failedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentProviderEvent" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "eventId" VARCHAR(100) NOT NULL,
    "providerReference" VARCHAR(100) NOT NULL,
    "eventType" VARCHAR(40) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "occurredAt" TIMESTAMPTZ(6) NOT NULL,
    "processedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "PaymentProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockPaymentCheckout" (
    "id" UUID NOT NULL,
    "providerReference" VARCHAR(100) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" VARCHAR(80) NOT NULL,
    "tokenHash" VARCHAR(64),
    "expiresAt" TIMESTAMPTZ(6),
    "result" "PaymentStatus",
    "eventId" VARCHAR(100),
    "occurredAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockPaymentCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContractingCredential_tokenHash_key" ON "ContractingCredential"("tokenHash");

-- CreateIndex
CREATE INDEX "ContractingCredential_requestId_kind_idx" ON "ContractingCredential"("requestId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Contracting_requestId_key" ON "Contracting"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerReference_key" ON "Payment"("providerReference");

-- CreateIndex
CREATE INDEX "Payment_contractingId_createdAt_idx" ON "Payment"("contractingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_contractingId_idempotencyKey_key" ON "Payment"("contractingId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentProviderEvent_provider_eventId_key" ON "PaymentProviderEvent"("provider", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "MockPaymentCheckout_providerReference_key" ON "MockPaymentCheckout"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "MockPaymentCheckout_tokenHash_key" ON "MockPaymentCheckout"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "MockPaymentCheckout_eventId_key" ON "MockPaymentCheckout"("eventId");

-- AddForeignKey
ALTER TABLE "ContractingCredential" ADD CONSTRAINT "ContractingCredential_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "InstitutionRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contracting" ADD CONSTRAINT "Contracting_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "InstitutionRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contracting" ADD CONSTRAINT "Contracting_confirmedPlanId_fkey" FOREIGN KEY ("confirmedPlanId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_contractingId_fkey" FOREIGN KEY ("contractingId") REFERENCES "Contracting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "Payment_one_pending_per_contract" ON "Payment" ("contractingId") WHERE "status" = 'PENDING';
ALTER TABLE "Plan" ADD CONSTRAINT "Plan_price_nonnegative" CHECK ("price" IS NULL OR "price" >= 0);
ALTER TABLE "Contracting" ADD CONSTRAINT "Contracting_price_nonnegative" CHECK ("priceSnapshot" >= 0);
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0);
