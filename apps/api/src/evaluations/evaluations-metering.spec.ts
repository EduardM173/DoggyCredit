/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { EvaluationsService } from "./evaluations.service.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import type { ClientsService } from "../clients/public.js";
import type { TenantPreparationService, TenantContext } from "../identity-tenants/public.js";
import type { AuditWriter } from "../audit/public.js";
import type { BankMockSource } from "../financial-integrations/public.js";
import type { FinancialProfileCalculator } from "../financial-profile/public.js";
import type { EvaluationRecommender } from "../recommendations/public.js";
import type { ResilientSources } from "../financial-integrations/public.js";

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

describe("HU-21 and OPS-01: evaluation usage metering", () => {
  let service: EvaluationsService;
  let mockDb: any;
  let mockPreparation: any;
  let mockBank: any;
  let mockBureau: any;
  let mockProfileCalculator: any;
  let mockRecommender: any;

  beforeEach(() => {
    mockDb = {
      run: jest.fn<any>().mockImplementation(async (cb: any) => cb()),
      client: {
        $queryRaw: jest.fn<any>().mockImplementation((query: TemplateStringsArray, ...values: any[]) => {
          const sql = query.join("");
          if (sql.includes('FROM "TenantMembership"'))
            return Promise.resolve([{ membershipStatus: "ACTIVE", tenantStatus: "ACTIVE", userStatus: "ACTIVE" }]);
          if (sql.includes('FROM "TenantSubscription"'))
            return Promise.resolve([{ status: "ACTIVE", startsAt: new Date("2026-01-01"), endsAt: null }]);
          if (sql.includes('FROM "Client"')) return Promise.resolve([{ id: values[0] }]);
          return Promise.resolve([]);
        }),
        evaluation: {
          findFirst: jest.fn(),
          findUniqueOrThrow: jest.fn(),
          update: jest.fn(),
          updateMany: jest.fn<any>().mockResolvedValue({ count: 1 }),
        },
        tenantSubscription: { findFirst: jest.fn<any>().mockResolvedValue({ id: "sub-1" }) },
        usageRecord: { create: jest.fn<any>().mockResolvedValue({ id: "usage-1" }) },
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
    );
  });

  it("does not count an evaluation when a competing request already claimed it", async () => {
    mockDb.client.evaluation.findFirst.mockResolvedValueOnce({
      id: "eval-quota-1",
      tenantId: "tenant-a",
      clientId: "client-1",
      createdByMembershipId: "membership-1",
      status: "DRAFT",
      consentGivenAt: new Date(),
      applicantSnapshot: { id: "client-1", type: "PERSON", documentType: "CI", documentNumber: "1234567", consent: { given: true, actorMembershipId: "membership-1" } },
      client: { documentNumber: "1234567", type: "PERSON", documentType: "CI" },
    });
    mockPreparation.read.mockResolvedValueOnce({ ready: true, steps: { source: true, products: true } });
    mockDb.client.evaluation.updateMany.mockResolvedValueOnce({ count: 0 });
    mockDb.client.evaluation.findFirst.mockResolvedValueOnce({
      id: "eval-quota-1", tenantId: "tenant-a", status: "IN_PROGRESS", applicantSnapshot: {},
    });

    const result = await service.processEvaluation(makeContext(), "eval-quota-1");

    expect(result.status).toBe("IN_PROGRESS");
    expect(mockBank.query).not.toHaveBeenCalled();
    expect(mockDb.client.usageRecord.create).not.toHaveBeenCalled();
  });

  it("counts usage once when the evaluation completes", async () => {
    mockDb.client.evaluation.findFirst.mockResolvedValueOnce({
      id: "eval-success-usage",
      tenantId: "tenant-a",
      clientId: "client-1",
      createdByMembershipId: "membership-1",
      status: "DRAFT",
      consentGivenAt: new Date(),
      applicantSnapshot: { id: "client-1", type: "PERSON", documentType: "CI", documentNumber: "1234567", consent: { given: true, actorMembershipId: "membership-1" } },
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

    expect(mockDb.client.usageRecord.create).toHaveBeenCalledTimes(1);
    expect(mockDb.client.usageRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-a", referenceId: "eval-success-usage",
        idempotencyKey: "evaluation-completed/eval-success-usage",
      }),
    });
  });
});
