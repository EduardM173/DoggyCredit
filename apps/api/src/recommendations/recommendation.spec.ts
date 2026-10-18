import { jest } from "@jest/globals";
import { RecommendationService } from "./recommendation.service.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockFn = jest.Mock<any>;

describe("RecommendationService (HU-12)", () => {
  let service: RecommendationService;
  let mockDb: {
    client: {
      financialProduct: {
        findMany: MockFn;
      };
      evaluationRecommendation: {
        findFirst: MockFn;
        upsert: MockFn;
      };
      recommendationReason: {
        deleteMany: MockFn;
        createMany: MockFn;
      };
    };
    run: MockFn;
  };

  beforeEach(() => {
    mockDb = {
      client: {
        financialProduct: {
          findMany: jest.fn(),
        },
        evaluationRecommendation: {
          findFirst: jest.fn(),
          upsert: jest.fn(async ({ update, create }: any) => ({
            id: "rec-1",
            evaluatedAt: new Date("2026-10-10T20:00:00Z"),
            ...create,
            ...update,
          })),
        },
        recommendationReason: {
          deleteMany: jest.fn(),
          createMany: jest.fn(),
        },
      },
      run: jest.fn(async (work: () => Promise<unknown>) => work()),
    };

    service = new RecommendationService(mockDb as unknown as DatabaseUnitOfWork);
  });

  const baseProfile = {
    averageMonthlyIncome: 5000,
    averageMonthlyExpenses: 2000,
    disposableIncome: 3000,
    totalDebt: 3000,
    activeCredits: 1,
    debtToIncome: 0.15,
    hasRecentArrears: false,
    completeness: 1,
  };

  const sampleProducts = [
    {
      id: "prod-micro",
      tenantId: "tenant-bank-x",
      name: "Microcrédito Emprendedor",
      category: "MICRO_CREDIT",
      applicantScope: "PERSON",
      minAmount: "5000",
      maxAmount: "50000",
      maxDebtToIncome: "0.40",
      minMonthlyDisposableIncome: "1000",
      allowsRecentArrears: false,
      active: true,
      purposes: [{ purpose: "WORKING_CAPITAL" }, { purpose: "BUSINESS_INVESTMENT" }],
    },
    {
      id: "prod-green",
      tenantId: "tenant-bank-x",
      name: "Crédito Verde",
      category: "GREEN_CREDIT",
      applicantScope: "PERSON",
      minAmount: "10000",
      maxAmount: "80000",
      maxDebtToIncome: "0.45",
      minMonthlyDisposableIncome: "1500",
      allowsRecentArrears: false,
      active: true,
      purposes: [{ purpose: "GREEN_PROJECT" }],
    },
    {
      id: "prod-sme",
      tenantId: "tenant-bank-x",
      name: "Pyme Crece",
      category: "SME_CREDIT",
      applicantScope: "COMPANY",
      minAmount: "20000",
      maxAmount: "150000",
      maxDebtToIncome: "0.50",
      minMonthlyDisposableIncome: "3000",
      allowsRecentArrears: false,
      active: true,
      purposes: [{ purpose: "WORKING_CAPITAL" }],
    },
  ];

  it("PA-12.1: evaluates compatible product and generates explainable reasons (CA-12.06)", async () => {
    mockDb.client.financialProduct.findMany.mockResolvedValueOnce([sampleProducts[0]]);

    const results = await service.evaluate("tenant-bank-x", "eval-1", {
      applicantScope: "PERSON",
      purpose: "WORKING_CAPITAL",
      requestedAmount: 15000,
      profile: baseProfile,
    });

    expect(results).toHaveLength(1);
    const rec = results[0];
    expect(rec.productId).toBe("prod-micro");
    expect(rec.productName).toBe("Microcrédito Emprendedor");
    expect(rec.outcome).toBe("RECOMMENDED");
    expect(rec.ruleVersion).toBe("1.0.0");

    // All reasons should have passed
    expect(rec.reasons).toHaveLength(6);
    expect(rec.reasons.every((r) => r.passed)).toBe(true);

    // Reasons use business language, not code variables (CA-12.07)
    expect(rec.reasons.find((r) => r.code === "RULE_PURPOSE")?.message).toContain(
      "Finalidad del crédito admitida",
    );
    expect(rec.reasons.find((r) => r.code === "RULE_AMOUNT_RANGE")?.message).toContain(
      "Monto solicitado dentro del rango permitido",
    );
    expect(rec.reasons.find((r) => r.code === "RULE_MAX_DTI")?.message).toContain(
      "Relación deuda/ingreso",
    );
  });

  it("PA-12.2: correctly rejects incompatible products with specific failed reasons (CA-12.09)", async () => {
    mockDb.client.financialProduct.findMany.mockResolvedValueOnce(sampleProducts);

    const results = await service.evaluate("tenant-bank-x", "eval-1", {
      applicantScope: "PERSON",
      purpose: "WORKING_CAPITAL",
      requestedAmount: 15000,
      profile: {
        ...baseProfile,
        debtToIncome: 0.55, // exceeds 40%
      },
    });

    expect(results).toHaveLength(3);

    // Microcrédito fails due to DTI
    const micro = results.find((r) => r.productId === "prod-micro")!;
    expect(micro.outcome).toBe("NOT_COMPATIBLE");
    const dtiReason = micro.reasons.find((r) => r.code === "RULE_MAX_DTI")!;
    expect(dtiReason.passed).toBe(false);
    expect(dtiReason.message).toContain("excede el límite máximo admisible");

    // Crédito Verde fails due to purpose
    const green = results.find((r) => r.productId === "prod-green")!;
    expect(green.outcome).toBe("NOT_COMPATIBLE");
    const purposeReason = green.reasons.find((r) => r.code === "RULE_PURPOSE")!;
    expect(purposeReason.passed).toBe(false);
    expect(purposeReason.message).toContain("La finalidad solicitada no se encuentra contemplada");

    // Pyme Crece fails due to applicant scope (COMPANY vs PERSON)
    const sme = results.find((r) => r.productId === "prod-sme")!;
    expect(sme.outcome).toBe("NOT_COMPATIBLE");
    const scopeReason = sme.reasons.find((r) => r.code === "RULE_APPLICANT_SCOPE")!;
    expect(scopeReason.passed).toBe(false);
    expect(scopeReason.message).toContain("exclusivamente a empresas");
  });

  it("PA-12.3: enforces strict tenant catalog isolation (CA-12.02, CA-12.03)", async () => {
    mockDb.client.financialProduct.findMany.mockResolvedValueOnce([]);

    await service.evaluate("tenant-banco-y", "eval-2", {
      applicantScope: "PERSON",
      purpose: "WORKING_CAPITAL",
      requestedAmount: 10000,
      profile: baseProfile,
    });

    expect(mockDb.client.financialProduct.findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-banco-y", active: true },
      include: { purposes: true },
      orderBy: { name: "asc" },
    });
  });

  it("CA-12.08: sorts recommended products ahead of incompatible ones with category priority", async () => {
    mockDb.client.financialProduct.findMany.mockResolvedValueOnce(sampleProducts);

    const results = await service.evaluate("tenant-bank-x", "eval-1", {
      applicantScope: "PERSON",
      purpose: "WORKING_CAPITAL",
      requestedAmount: 15000,
      profile: baseProfile, // meets criteria for Microcrédito
    });

    expect(results[0].outcome).toBe("RECOMMENDED");
    expect(results[0].productId).toBe("prod-micro");
    expect(results[1].outcome).toBe("NOT_COMPATIBLE");
    expect(results[2].outcome).toBe("NOT_COMPATIBLE");
  });

  describe("HU-17 Acceptance Scenarios (PA-17)", () => {
    it("PA-17.01: recommends company product with usable company profile and explainable reasons", async () => {
      mockDb.client.financialProduct.findMany.mockResolvedValueOnce([sampleProducts[2]]); // Pyme Crece (COMPANY)

      const results = await service.evaluate("tenant-bank-x", "eval-company-1", {
        applicantScope: "COMPANY",
        purpose: "WORKING_CAPITAL",
        requestedAmount: 50000,
        profile: {
          ...baseProfile,
          averageMonthlyIncome: 80000,
          disposableIncome: 35000,
          debtToIncome: 0.20,
        },
      });

      expect(results).toHaveLength(1);
      const rec = results[0];
      expect(rec.productId).toBe("prod-sme");
      expect(rec.outcome).toBe("RECOMMENDED");
      expect(rec.compatibilityStatus).toBe("COMPATIBLE");
      expect(rec.reasons.every((r) => r.passed)).toBe(true);

      const scopeReason = rec.reasons.find((r) => r.code === "RULE_APPLICANT_SCOPE")!;
      expect(scopeReason.message).toContain("Producto habilitado para empresas");
    });

    it("PA-17.02: marks product incompatible when company applicant is compared against person-only product", async () => {
      mockDb.client.financialProduct.findMany.mockResolvedValueOnce([sampleProducts[0]]); // Microcrédito (PERSON)

      const results = await service.evaluate("tenant-bank-x", "eval-company-2", {
        applicantScope: "COMPANY",
        purpose: "WORKING_CAPITAL",
        requestedAmount: 20000,
        profile: baseProfile,
      });

      expect(results).toHaveLength(1);
      const rec = results[0];
      expect(rec.outcome).toBe("NOT_COMPATIBLE");
      expect(rec.compatibilityStatus).toBe("INCOMPATIBLE");

      const scopeReason = rec.reasons.find((r) => r.code === "RULE_APPLICANT_SCOPE")!;
      expect(scopeReason.passed).toBe(false);
      expect(scopeReason.status).toBe("FAILED");
      expect(scopeReason.message).toContain("destinado exclusivamente a personas naturales");
    });

    it("PA-17.03 & PA-17.04: handles missing rule indicator without assuming pass or fail, categorizing as NOT_EVALUABLE", async () => {
      mockDb.client.financialProduct.findMany.mockResolvedValueOnce([sampleProducts[0]]);

      const results = await service.evaluate("tenant-bank-x", "eval-partial-1", {
        applicantScope: "PERSON",
        purpose: "WORKING_CAPITAL",
        requestedAmount: 15000,
        profile: {
          ...baseProfile,
          debtToIncome: null, // missing income / DTI indicator
        },
      });

      expect(results).toHaveLength(1);
      const rec = results[0];
      // PA-17.04: Not presented as incompatible
      expect(rec.outcome).toBe("NOT_EVALUABLE");
      expect(rec.compatibilityStatus).toBe("NOT_EVALUABLE");

      const dtiReason = rec.reasons.find((r) => r.code === "RULE_MAX_DTI_NOT_EVALUABLE")!;
      expect(dtiReason).toBeDefined();
      expect(dtiReason.passed).toBe(false);
      expect(dtiReason.status).toBe("NOT_EVALUABLE");
      expect(dtiReason.message).toContain("Esta condición no se asume cumplida ni incumplida");
    });

    it("PA-17.05: returns completed evaluation without compatible products when no active product matches", async () => {
      mockDb.client.financialProduct.findMany.mockResolvedValueOnce(sampleProducts);

      const results = await service.evaluate("tenant-bank-x", "eval-nocompat-1", {
        applicantScope: "PERSON",
        purpose: "OTHER", // No product supports OTHER
        requestedAmount: 500000, // Exceeds all max amounts
        profile: baseProfile,
      });

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.outcome === "NOT_COMPATIBLE")).toBe(true);
      expect(results.every((r) => r.compatibilityStatus === "INCOMPATIBLE")).toBe(true);
    });
  });
});
