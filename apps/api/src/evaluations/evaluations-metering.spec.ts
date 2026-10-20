import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { ForbiddenException } from "@nestjs/common";
import { EvaluationsService } from "./evaluations.service.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import type { ClientsService } from "../clients/public.js";
import type { TenantPreparationService, TenantContext } from "../identity-tenants/public.js";
import type { AuditWriter } from "../audit/public.js";
import type { BankMockSource } from "../financial-integrations/public.js";
import type { FinancialProfileCalculator } from "../financial-profile/public.js";
import type { EvaluationRecommender } from "../recommendations/public.js";
import type { ResilientSources } from "../financial-integrations/resilience/resilient-sources.js";

const makeContext = (overrides?: Partial<TenantContext>): TenantContext => ({
  userId: "user-1",
  tenantId: "tenant-a",
  tenantSlug: "banco-a",
  membershipId: "membership-1",
  role: "ANALYST",
  userName: "Carlos Analista",
  tenantName: "Banco A",
  taxId: "1234567012",
  institutionType: "COMMERCIAL_BANK",
  ...overrides,
});

describe("HU-21: Plan Quota and Usage Metering in EvaluationsService", () => {
  let service: EvaluationsService;
  let mockDb: any;
  let mockPreparation: any;
  let mockPlanMetering: any;
  let mockBank: any;
  let mockBureau: any;
  let mockProfileCalculator: any;
  let mockRecommender: any;

  beforeEach(() => {
    mockDb = {
      run: jest.fn<any>().mockImplementation(async (cb: any) => cb()),
      client: {
        evaluation: {
          findFirst: jest.fn(),
          findUniqueOrThrow: jest.fn(),
          update: jest.fn(),
        },
        integrationProvider: {
          findUnique: jest.fn(),
        },
        evaluationSourceResult: {
          upsert: jest.fn(),
        },
      },
    };

    mockPreparation = {
      read: jest.fn(),
    };

    mockPlanMetering = {
      checkQuotaAvailable: jest.fn<any>().mockResolvedValue(undefined),
      recordEvaluationUsage: jest.fn<any>().mockResolvedValue(true),
    };

    mockBank = {
      query: jest.fn(),
      status: jest.fn<any>().mockResolvedValue({ enabled: true, available: true }),
    };

    mockBureau = {
      query: jest.fn(),
      status: jest.fn<any>().mockResolvedValue({ enabled: false, available: false }),
    };

    mockProfileCalculator = {
      calculate: jest.fn(),
      consolidate: jest.fn<any>().mockReturnValue({}),
      saveProfile: jest.fn(),
    };

    mockRecommender = {
      recommend: jest.fn(),
      evaluate: jest.fn<any>().mockResolvedValue([]),
    };

    service = new EvaluationsService(
      mockDb as unknown as DatabaseUnitOfWork,
      {} as unknown as ClientsService,
      mockPreparation as unknown as TenantPreparationService,
      { recordEvaluationProcessed: jest.fn() } as unknown as AuditWriter,
      mockBank as unknown as BankMockSource,
      mockBureau as unknown as any,
      mockProfileCalculator as unknown as FinancialProfileCalculator,
      mockRecommender as unknown as EvaluationRecommender,
      {
        queryBank: (_p: any, ...args: any[]) => mockBank.query(...args),
        queryBureau: (_p: any, ...args: any[]) => mockBureau.query(...args),
      } as unknown as ResilientSources,
      mockPlanMetering as unknown as any,
    );
  });

  it("rejects processing when tenant has reached monthly evaluation quota (CA-21.04, CA-21.05)", async () => {
    mockDb.client.evaluation.findFirst.mockResolvedValueOnce({
      id: "eval-quota-1",
      tenantId: "tenant-a",
      status: "DRAFT",
      consentGivenAt: new Date(),
      applicantSnapshot: { type: "PERSON", documentType: "CI", documentNumber: "1234567" },
    });

    mockPlanMetering.checkQuotaAvailable.mockRejectedValueOnce(
      new ForbiddenException({
        statusCode: 403,
        code: "PLAN_QUOTA_EXCEEDED",
        message: "Límite mensual del plan alcanzado (50/50 evaluaciones).",
        consumed: 50,
        limit: 50,
      }),
    );

    await expect(
      service.processEvaluation(makeContext(), "eval-quota-1"),
    ).rejects.toThrow(ForbiddenException);

    expect(mockPlanMetering.checkQuotaAvailable).toHaveBeenCalledWith("tenant-a", "ANALYST");
    // Evaluation state must not have transitioned to IN_PROGRESS
    expect(mockDb.client.evaluation.update).not.toHaveBeenCalled();
    expect(mockPlanMetering.recordEvaluationUsage).not.toHaveBeenCalled();
  });

  it("records evaluation usage when transition to IN_PROGRESS succeeds (CA-21.03, CA-21.13)", async () => {
    mockDb.client.evaluation.findFirst.mockResolvedValueOnce({
      id: "eval-success-usage",
      tenantId: "tenant-a",
      status: "DRAFT",
      consentGivenAt: new Date(),
      applicantSnapshot: { type: "PERSON", documentType: "CI", documentNumber: "1234567" },
      client: { documentNumber: "1234567", type: "PERSON", documentType: "CI" },
      sourceResults: [],
      recommendations: [],
    });

    mockPreparation.read.mockResolvedValueOnce({
      ready: true,
      completed: 3,
      percentage: 100,
      steps: { institution: true, source: true, products: true },
      tenant: { name: "Banco A" },
      supportedApplicantTypes: {
        PERSON: { supported: true },
        COMPANY: { supported: false },
      },
    });

    mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce({ id: "p-bank", code: "BANK_MOCK" });

    mockBank.query.mockResolvedValueOnce({
      status: "SUCCESS",
      data: { documentNumber: "1234567", accounts: [], loans: [], reportedAt: "2026-10-10", currency: "BOB" },
    });

    mockDb.client.evaluationSourceResult.upsert.mockResolvedValueOnce({ id: "sr-1", status: "SUCCESS" });
    mockProfileCalculator.calculate.mockReturnValueOnce({ completeness: 1, profileVersion: "1.0.0" });
    mockProfileCalculator.saveProfile.mockResolvedValueOnce({ id: "prof-1" });

    mockDb.client.evaluation.update
      .mockResolvedValueOnce({ id: "eval-success-usage", status: "IN_PROGRESS" })
      .mockResolvedValueOnce({ id: "eval-success-usage", status: "COMPLETED" });

    mockDb.client.evaluation.findUniqueOrThrow.mockResolvedValueOnce({
      id: "eval-success-usage",
      tenantId: "tenant-a",
      status: "COMPLETED",
      client: { name: "Juan", documentType: "CI", documentNumber: "1234567" },
      applicantSnapshot: { name: "Juan" },
      sourceResults: [],
      recommendations: [],
      profile: null,
    });

    await service.processEvaluation(makeContext(), "eval-success-usage");

    expect(mockPlanMetering.checkQuotaAvailable).toHaveBeenCalledWith("tenant-a", "ANALYST");
    expect(mockPlanMetering.recordEvaluationUsage).toHaveBeenCalledWith("tenant-a", "eval-success-usage");
  });
});
