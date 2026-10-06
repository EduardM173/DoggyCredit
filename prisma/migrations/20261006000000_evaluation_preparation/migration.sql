ALTER TABLE "Client" ADD COLUMN "firstName" VARCHAR(90), ADD COLUMN "lastName" VARCHAR(90), ADD COLUMN "birthDate" DATE;
ALTER TABLE "Evaluation" ADD COLUMN "requestFingerprint" VARCHAR(64);
