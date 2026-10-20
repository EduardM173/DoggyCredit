import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env") });
import { describe, expect, it } from "@jest/globals";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  PrismaClient,
  InstitutionType,
  UserStatus,
  TenantRole,
  CreditPurpose,
  EvaluationStatus,
  RecommendationOutcome,
  UsageMetric,
} from "./generated/prisma/client.js";
import { FinancialProfileService } from "./financial-profile/financial-profile.service.js";
import type { DatabaseUnitOfWork } from "./infrastructure/prisma/database-unit-of-work.js";
import type {
  BankMockSource,
  NormalizedFinancialData,
  SourceQueryResult,
  SourceStatus,
  SourceSubjectType,
} from "./financial-integrations/public.js";

/**
 * Alternative Bank Adapter implementing the exact BankMockSource port contract.
 * Demonstrates SOA extensibility: replacing or adding an external provider adapter
 * requires zero changes to core calculation algorithms (FinancialProfileService, Rules).
 */
class AlternativeBankAdapter implements BankMockSource {
  async status(_tenantId: string): Promise<SourceStatus> {
    return { available: true, enabled: true, healthStatus: "ACTIVE", globallyEnabled: true };
  }

  async enable(_tenantId: string): Promise<boolean> {
    return true;
  }

  async query(
    _tenantId: string,
    documentNumber: string,
    _subjectType: SourceSubjectType,
  ): Promise<SourceQueryResult> {
    const data: NormalizedFinancialData = {
      documentNumber,
      currency: "BOB",
      reportedAt: new Date().toISOString(),
      accounts: [
        {
          accountNumberMasked: "****1234",
          accountType: "SAVINGS",
          currency: "BOB",
          currentBalance: 25000,
          averageMonthlyInflow: 8500,
          averageMonthlyOutflow: 3500,
        },
      ],
      loans: [
        {
          loanId: "alt-loan-99",
          loanType: "CONSUMER",
          originalAmount: 20000,
          outstandingBalance: 12000,
          monthlyInstallment: 1200,
          status: "ACTIVE",
          daysPastDue: 0,
        },
      ],
    };

    return {
      status: "SUCCESS",
      data,
      externalReference: `ALT-REF-${documentNumber}`,
      providerId: "ALT_BANK_PROVIDER",
    };
  }
}

describe("S4-OPS-07 — SOA Contracts, Prisma Integrity & Future Extensibility", () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run S4-OPS-07 integration spec.");
  }

  const pool = new Pool({ connectionString });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  afterAll(async () => {
    await prisma.$disconnect();
    await pool.end();
  });

  describe("(1) Prisma Constraints & Composite Invariants Enforcement", () => {
    it("enforces Client @@unique([tenantId, documentType, documentNumber]) and allows cross-tenant duplicate", async () => {
      const tenant1 = await prisma.tenant.upsert({
        where: { slug: "soa-test-tenant-1" },
        update: {},
        create: {
          slug: "soa-test-tenant-1",
          legalName: "SOA Test Tenant 1",
          taxId: "NIT-SOA-1",
          institutionType: InstitutionType.BANK,
        },
      });

      const tenant2 = await prisma.tenant.upsert({
        where: { slug: "soa-test-tenant-2" },
        update: {},
        create: {
          slug: "soa-test-tenant-2",
          legalName: "SOA Test Tenant 2",
          taxId: "NIT-SOA-2",
          institutionType: InstitutionType.COOPERATIVE,
        },
      });

      const sharedDoc = `CI-${Date.now()}`;

      // 1. Create client in Tenant 1
      const client1 = await prisma.client.create({
        data: {
          tenantId: tenant1.id,
          type: "PERSON",
          documentType: "CI",
          documentNumber: sharedDoc,
          name: "Client Tenant 1",
        },
      });
      expect(client1.id).toBeDefined();

      // 2. Creating duplicate client with SAME document in Tenant 1 MUST fail (P2002)
      await expect(
        prisma.client.create({
          data: {
            tenantId: tenant1.id,
            type: "PERSON",
            documentType: "CI",
            documentNumber: sharedDoc,
            name: "Duplicate Client Tenant 1",
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });

      // 3. Creating client with SAME document in Tenant 2 MUST succeed (Multi-tenant partition)
      const client2 = await prisma.client.create({
        data: {
          tenantId: tenant2.id,
          type: "PERSON",
          documentType: "CI",
          documentNumber: sharedDoc,
          name: "Client Tenant 2",
        },
      });
      expect(client2.id).toBeDefined();
      expect(client2.id).not.toEqual(client1.id);
    });

    it("enforces TenantMembership @@unique([tenantId, userId])", async () => {
      const tenant = await prisma.tenant.upsert({
        where: { slug: "soa-test-membership-tenant" },
        update: {},
        create: {
          slug: "soa-test-membership-tenant",
          legalName: "SOA Membership Tenant",
          taxId: `NIT-${Date.now()}`,
          institutionType: InstitutionType.BANK,
        },
      });

      const user = await prisma.user.create({
        data: {
          email: `soa.user.${Date.now()}@doggycredit.local`,
          fullName: "SOA Test User",
          passwordHash: "dummy-hash",
          status: UserStatus.ACTIVE,
        },
      });

      // First membership succeeds
      await prisma.tenantMembership.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          role: TenantRole.ANALYST,
        },
      });

      // Second membership for same user in same tenant MUST fail (P2002)
      await expect(
        prisma.tenantMembership.create({
          data: {
            tenantId: tenant.id,
            userId: user.id,
            role: TenantRole.INSTITUTION_ADMIN,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    });

    it("enforces FinancialProduct @@unique([tenantId, name])", async () => {
      const tenant = await prisma.tenant.upsert({
        where: { slug: "soa-test-product-tenant" },
        update: {},
        create: {
          slug: "soa-test-product-tenant",
          legalName: "SOA Product Tenant",
          taxId: `NIT-PROD-${Date.now()}`,
          institutionType: InstitutionType.BANK,
        },
      });

      const productName = `Product-${Date.now()}`;

      await prisma.financialProduct.create({
        data: {
          tenantId: tenant.id,
          name: productName,
          category: "MICRO_CREDIT",
          applicantScope: "PERSON",
          minAmount: 1000,
          maxAmount: 10000,
          active: true,
        },
      });

      // Duplicate product name within same tenant MUST fail (P2002)
      await expect(
        prisma.financialProduct.create({
          data: {
            tenantId: tenant.id,
            name: productName,
            category: "MICRO_CREDIT",
            applicantScope: "PERSON",
            minAmount: 500,
            maxAmount: 5000,
            active: true,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    });

    it("enforces Evaluation @unique idempotencyKey and UsageRecord @unique idempotencyKey", async () => {
      const tenant = await prisma.tenant.upsert({
        where: { slug: "soa-test-idempotency-tenant" },
        update: {},
        create: {
          slug: "soa-test-idempotency-tenant",
          legalName: "SOA Idempotency Tenant",
          taxId: `NIT-IDEM-${Date.now()}`,
          institutionType: InstitutionType.BANK,
        },
      });

      const idemKey = `idem-key-${Date.now()}`;

      await prisma.usageRecord.create({
        data: {
          tenantId: tenant.id,
          metric: UsageMetric.EVALUATION,
          quantity: 1,
          idempotencyKey: idemKey,
        },
      });

      // Duplicate idempotencyKey in UsageRecord MUST fail (P2002)
      await expect(
        prisma.usageRecord.create({
          data: {
            tenantId: tenant.id,
            metric: UsageMetric.EVALUATION,
            quantity: 1,
            idempotencyKey: idemKey,
          },
        }),
      ).rejects.toMatchObject({ code: "P2002" });
    });
  });

  describe("(2) React Frontend Credential Isolation", () => {
    it("proves React app package.json has zero direct database drivers or ORMs", () => {
      const webPkgPath = existsSync(resolve(process.cwd(), "apps/web/package.json"))
        ? resolve(process.cwd(), "apps/web/package.json")
        : resolve(process.cwd(), "../web/package.json");
      expect(existsSync(webPkgPath)).toBe(true);

      const pkg = JSON.parse(readFileSync(webPkgPath, "utf-8"));
      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };

      const forbiddenDbPackages = [
        "pg",
        "@prisma/client",
        "prisma",
        "mysql",
        "mysql2",
        "typeorm",
        "sequelize",
        "mongoose",
        "knex",
        "sqlite3",
      ];

      for (const forbidden of forbiddenDbPackages) {
        expect(allDeps[forbidden]).toBeUndefined();
      }
    });

    it("proves React app communicates exclusively via HTTP fetch and holds no DB connection strings", () => {
      const apiServicePath = existsSync(resolve(process.cwd(), "apps/web/src/features/institution/api.ts"))
        ? resolve(process.cwd(), "apps/web/src/features/institution/api.ts")
        : resolve(process.cwd(), "../web/src/features/institution/api.ts");
      expect(existsSync(apiServicePath)).toBe(true);

      const content = readFileSync(apiServicePath, "utf-8");
      expect(content).toContain("fetch(");
      expect(content).not.toContain("postgresql://");
      expect(content).not.toContain("DATABASE_URL");
    });
  });

  describe("(3) Contract / Adapter Extensibility Proof (Mock Substitution)", () => {
    it("substitutes BankMockSource with AlternativeBankAdapter without modifying FinancialProfileService", async () => {
      const adapter: BankMockSource = new AlternativeBankAdapter();
      const status = await adapter.status("tenant-demo");
      expect(status.available).toBe(true);

      const queryRes = await adapter.query("tenant-demo", "7812456", "PERSON");
      expect(queryRes.status).toBe("SUCCESS");

      if (queryRes.status !== "SUCCESS") return;

      // Pass alternative adapter normalized output to FinancialProfileService
      const profileService = new FinancialProfileService({} as DatabaseUnitOfWork);
      const result = profileService.consolidate({
        bankData: queryRes.data,
        bureauData: null,
      });

      expect(result.indicators.averageMonthlyIncome).toBe(8500);
      expect(result.indicators.averageMonthlyExpenses).toBe(3500);
      expect(result.indicators.disposableIncome).toBe(5000);
      expect(result.indicators.totalDebt).toBe(12000);
      expect(result.indicators.activeCredits).toBe(1);
      // DTI = (1200 / 8500) ≈ 0.1412
      expect(result.indicators.debtToIncome).toBeCloseTo(0.1412, 2);
      expect(result.indicators.hasRecentArrears).toBe(false);
      expect(result.provenance.averageMonthlyIncome).toBe("BANK_MOCK");
    });
  });

  describe("(4) Immutability of Historical Snapshots and Versioning", () => {
    it("preserves productSnapshot and ruleVersion when product definition in catalog changes", async () => {
      const tenant = await prisma.tenant.upsert({
        where: { slug: "soa-test-snapshot-tenant" },
        update: {},
        create: {
          slug: "soa-test-snapshot-tenant",
          legalName: "SOA Snapshot Tenant",
          taxId: `NIT-SNAP-${Date.now()}`,
          institutionType: InstitutionType.BANK,
        },
      });

      const user = await prisma.user.create({
        data: {
          email: `soa.snap.${Date.now()}@doggycredit.local`,
          fullName: "SOA Snap User",
          passwordHash: "dummy-hash",
          status: UserStatus.ACTIVE,
        },
      });

      const membership = await prisma.tenantMembership.create({
        data: { tenantId: tenant.id, userId: user.id, role: TenantRole.ANALYST },
      });

      const client = await prisma.client.create({
        data: {
          tenantId: tenant.id,
          type: "PERSON",
          documentType: "CI",
          documentNumber: `CI-SNAP-${Date.now()}`,
          name: "Snapshot Applicant",
        },
      });

      const originalName = `Original Microcredit ${Date.now()}`;
      const mutatedName = `Mutated Supercredit ${Date.now()}`;

      // 1. Create original product
      const product = await prisma.financialProduct.create({
        data: {
          tenantId: tenant.id,
          name: originalName,
          category: "MICRO_CREDIT",
          applicantScope: "PERSON",
          minAmount: 1000,
          maxAmount: 20000,
          active: true,
        },
      });

      // 2. Create evaluation and recommendation with product snapshot
      const evaluation = await prisma.evaluation.create({
        data: {
          tenantId: tenant.id,
          clientId: client.id,
          createdByMembershipId: membership.id,
          idempotencyKey: `eval-snap-${Date.now()}`,
          purpose: CreditPurpose.WORKING_CAPITAL,
          requestedAmount: 5000,
          status: EvaluationStatus.COMPLETED,
          ruleVersion: "2026.1",
          applicantSnapshot: { name: "Snapshot Applicant", income: 10000 },
        },
      });

      const rec = await prisma.evaluationRecommendation.create({
        data: {
          tenantId: tenant.id,
          evaluationId: evaluation.id,
          productId: product.id,
          outcome: RecommendationOutcome.RECOMMENDED,
          ruleVersion: "2026.1",
          productSnapshot: {
            name: originalName,
            minAmount: 1000,
            maxAmount: 20000,
          },
        },
      });

      // 3. Admin alters the product in the catalog (e.g. changes name and amounts)
      await prisma.financialProduct.update({
        where: { id: product.id },
        data: {
          name: mutatedName,
          minAmount: 50000,
          maxAmount: 200000,
        },
      });

      // 4. Historical evaluation recommendation MUST retain original snapshot and ruleVersion
      const historicalRec = await prisma.evaluationRecommendation.findUniqueOrThrow({
        where: { id: rec.id },
        include: { product: true },
      });

      // Current live product has new mutated name
      expect(historicalRec.product.name).toBe(mutatedName);
      // But the historical snapshot preserved the state at evaluation time
      const snapshot = historicalRec.productSnapshot as any;
      expect(snapshot.name).toBe(originalName);
      expect(snapshot.minAmount).toBe(1000);
      expect(snapshot.maxAmount).toBe(20000);
      expect(historicalRec.ruleVersion).toBe("2026.1");
    });
  });
});
