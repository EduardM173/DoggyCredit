-- AlterTable
ALTER TABLE "EmailVerificationToken" ADD COLUMN     "invalidatedAt" TIMESTAMPTZ(6),
ADD COLUMN     "sentAt" TIMESTAMPTZ(6);
