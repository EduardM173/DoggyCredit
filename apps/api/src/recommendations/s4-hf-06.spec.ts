import { jest } from "@jest/globals";
import { RecommendationService } from "./recommendation.service.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockFn = jest.Mock<any>;

/**
 * S4-HF-06 — Congelar reglas y productos durante la evaluación.
 * Pruebas de reproducción: describen el contrato que debe cumplirse; si fallan
 * contra el código, el bug queda confirmado.
 */
describe("S4-HF-06 — Recomendador: producto y reglas congelados por operación", () => {
  let service: RecommendationService;
  let insideUnitOfWork: boolean;
  let runCalls: number;
  let writesOutsideUnitOfWork: string[];
  let mockDb: {
    client: {
      financialProduct: { findMany: MockFn };
      evaluationRecommendation: { findFirst: MockFn; upsert: MockFn };
      recommendationReason: { deleteMany: MockFn; createMany: MockFn };
    };
    run: MockFn;
  };

  const product = {
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
  };

  const context = {
    applicantScope: "PERSON",
    purpose: "WORKING_CAPITAL",
    requestedAmount: 15000,
    profile: {
      averageMonthlyIncome: 5000,
      averageMonthlyExpenses: 2000,
      disposableIncome: 3000,
      totalDebt: 3000,
      activeCredits: 1,
      debtToIncome: 0.15,
      hasRecentArrears: false,
      completeness: 1,
    },
  };

  beforeEach(() => {
    insideUnitOfWork = false;
    runCalls = 0;
    writesOutsideUnitOfWork = [];

    const guarded = <T>(label: string, impl: (...args: any[]) => T) =>
      jest.fn((...args: any[]) => {
        if (!insideUnitOfWork) writesOutsideUnitOfWork.push(label);
        return impl(...args);
      });

    mockDb = {
      client: {
        financialProduct: {
          findMany: guarded("financialProduct.findMany", () => Promise.resolve([product])) as MockFn,
        },
        evaluationRecommendation: {
          findFirst: guarded("evaluationRecommendation.findFirst", () => Promise.resolve(null)) as MockFn,
          upsert: guarded("evaluationRecommendation.upsert", ({ update, create }: any) =>
            Promise.resolve({
              id: "rec-1",
              evaluatedAt: new Date("2026-10-18T10:00:00Z"),
              ...create,
              ...update,
            }),
          ) as MockFn,
        },
        recommendationReason: {
          deleteMany: guarded("recommendationReason.deleteMany", () =>
            Promise.resolve({ count: 0 }),
          ) as MockFn,
          createMany: guarded("recommendationReason.createMany", () =>
            Promise.resolve({ count: 0 }),
          ) as MockFn,
        },
      },
      run: jest.fn(async (work: () => Promise<unknown>) => {
        runCalls += 1;
        insideUnitOfWork = true;
        try {
          return await work();
        } finally {
          insideUnitOfWork = false;
        }
      }) as MockFn,
    };

    service = new RecommendationService(mockDb as unknown as DatabaseUnitOfWork);
  });

  it("HF-06/1: guarda junto a cada recomendación el producto y sus reglas tal como estaban al evaluar", async () => {
    await service.evaluate("tenant-bank-x", "eval-1", context);

    const call = mockDb.client.evaluationRecommendation.upsert.mock.calls[0][0] as any;
    expect(call.create.productSnapshot).toEqual(
      expect.objectContaining({
        name: "Microcrédito Emprendedor",
        category: "MICRO_CREDIT",
        applicantScope: "PERSON",
        minAmount: 5000,
        maxAmount: 50000,
        maxDebtToIncome: 0.4,
        minMonthlyDisposableIncome: 1000,
        allowsRecentArrears: false,
        purposes: expect.arrayContaining(["WORKING_CAPITAL", "BUSINESS_INVESTMENT"]),
      }),
    );
  });

  it("HF-06/2: lee el catálogo una sola vez por operación y escribe todo dentro de una unidad de trabajo atómica", async () => {
    await service.evaluate("tenant-bank-x", "eval-1", context);

    expect(runCalls).toBe(1);
    expect(mockDb.client.financialProduct.findMany).toHaveBeenCalledTimes(1);
    expect(writesOutsideUnitOfWork).toEqual([]);
  });
});
