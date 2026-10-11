import { jest } from "@jest/globals";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { EvaluationsService } from "./evaluations.service.js";
import { DocumentTypeDto, CreditPurposeDto } from "./dto/create-evaluation.dto.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import type { ClientsService } from "../clients/public.js";
import type { TenantPreparationService, TenantContext } from "../identity-tenants/public.js";
import type { AuditWriter } from "../audit/public.js";
import type { BankMockSource } from "../financial-integrations/public.js";
import type { FinancialProfileCalculator } from "../financial-profile/public.js";

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

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockFn = jest.Mock<any>;

describe("EvaluationsService (HU-10 & HU-11)", () => {
  let service: EvaluationsService;
  let mockDb: {
    client: {
      evaluation: {
        findUnique: MockFn;
        findFirst: MockFn;
        findMany: MockFn;
        create: MockFn;
        update: MockFn;
      };
      evaluationSourceResult: {
        findFirst: MockFn;
        upsert: MockFn;
      };
    };
    run: MockFn;
  };
  let mockClients: {
    findByDocument: MockFn;
    findOrCreate: MockFn;
  };
  let mockPreparation: {
    read: MockFn;
  };
  let mockAudit: {
    recordEvaluationDraft: MockFn;
    recordEvaluationProcessed: MockFn;
  };
  let mockBank: {
    query: MockFn;
    status: MockFn;
    enable: MockFn;
  };
  let mockProfileCalculator: {
    calculate: MockFn;
    saveProfile: MockFn;
  };

  beforeEach(() => {
    mockDb = {
      client: {
        evaluation: {
          findUnique: jest.fn(),
          findFirst: jest.fn(),
          findMany: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
        evaluationSourceResult: {
          findFirst: jest.fn(),
          upsert: jest.fn(),
        },
      },
      run: jest.fn(async (cb: () => Promise<unknown>) => cb()),
    };

    mockClients = {
      findByDocument: jest.fn(),
      findOrCreate: jest.fn(),
    };

    mockPreparation = {
      read: jest.fn(),
    };

    mockAudit = {
      recordEvaluationDraft: jest.fn(),
      recordEvaluationProcessed: jest.fn(),
    };

    mockBank = {
      query: jest.fn(),
      status: jest.fn(),
      enable: jest.fn(),
    };

    mockProfileCalculator = {
      calculate: jest.fn(),
      saveProfile: jest.fn(),
    };

    service = new EvaluationsService(
      mockDb as unknown as DatabaseUnitOfWork,
      mockClients as unknown as ClientsService,
      mockPreparation as unknown as TenantPreparationService,
      mockAudit as unknown as AuditWriter,
      mockBank as unknown as BankMockSource,
      mockProfileCalculator as unknown as FinancialProfileCalculator,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("HU-10: checkReadiness()", () => {
    it("returns ready true when preparation is 3/3", async () => {
      mockPreparation.read.mockResolvedValueOnce({
        ready: true,
        completed: 3,
        percentage: 100,
        steps: { institution: true, source: true, products: true },
        tenant: { name: "Banco A" },
      });

      const res = await service.checkReadiness(makeContext());
      expect(res.ready).toBe(true);
      expect(res.completed).toBe(3);
      expect(res.tenantName).toBe("Banco A");
    });
  });

  describe("HU-10: createDraft()", () => {
    it("rejects draft creation if tenant is not ready", async () => {
      mockPreparation.read.mockResolvedValueOnce({
        ready: false,
        completed: 1,
        percentage: 33,
        steps: { institution: true, source: false, products: false },
        tenant: { name: "Banco A" },
      });

      await expect(
        service.createDraft(makeContext(), {
          documentType: DocumentTypeDto.CI,
          documentNumber: "1234567",
          name: "Juan Perez",
          purpose: CreditPurposeDto.WORKING_CAPITAL,
          requestedAmount: 10000,
          consentGiven: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("creates draft evaluation with applicant snapshot and consent", async () => {
      mockPreparation.read.mockResolvedValueOnce({
        ready: true,
        completed: 3,
        percentage: 100,
        steps: { institution: true, source: true, products: true },
        tenant: { name: "Banco A" },
      });
      mockDb.client.evaluation.findUnique.mockResolvedValueOnce(null);
      mockClients.findOrCreate.mockResolvedValueOnce({
        client: {
          id: "client-1",
          type: "PERSON",
          documentType: "CI",
          documentNumber: "1234567",
          name: "Juan Perez",
        },
        created: true,
      });
      mockDb.client.evaluation.create.mockResolvedValueOnce({
        id: "eval-1",
        tenantId: "tenant-a",
        clientId: "client-1",
        createdByMembershipId: "membership-1",
        idempotencyKey: "key-1",
        purpose: "WORKING_CAPITAL",
        requestedAmount: 10000,
        status: "DRAFT",
        consentGivenAt: new Date(),
        applicantSnapshot: { name: "Juan Perez", documentNumber: "1234567" },
        ruleVersion: "1.0.0",
        createdAt: new Date(),
        updatedAt: new Date(),
        client: { name: "Juan Perez", documentType: "CI", documentNumber: "1234567" },
      });

      const res = await service.createDraft(makeContext(), {
        documentType: DocumentTypeDto.CI,
        documentNumber: "1234567",
        name: "Juan Perez",
        purpose: CreditPurposeDto.WORKING_CAPITAL,
        requestedAmount: 10000,
        consentGiven: true,
        idempotencyKey: "key-1",
      });

      expect(res.id).toBe("eval-1");
      expect(res.status).toBe("DRAFT");
      expect(mockAudit.recordEvaluationDraft).toHaveBeenCalled();
    });
  });

  describe("HU-11: processEvaluation()", () => {
    const mockDraftEval = {
      id: "eval-1",
      tenantId: "tenant-a",
      clientId: "client-1",
      documentNumber: "1234567",
      status: "DRAFT",
      consentGivenAt: new Date("2026-10-10T20:00:00Z"),
      startedAt: null,
      applicantSnapshot: { name: "Juan Perez", documentNumber: "1234567" },
      client: { name: "Juan Perez", documentType: "CI", documentNumber: "1234567" },
    };

    beforeEach(() => {
      mockPreparation.read.mockResolvedValue({
        ready: true,
        completed: 3,
        percentage: 100,
        steps: { institution: true, source: true, products: true },
        tenant: { name: "Banco A" },
      });
    });

    it("throws NotFoundException if evaluation does not exist or tenant does not match", async () => {
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce(null);

      await expect(service.processEvaluation(makeContext(), "eval-not-found")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("PA-11.1: processes successfully, creates profile and completes evaluation", async () => {
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce(mockDraftEval);
      mockDb.client.evaluation.update
        .mockResolvedValueOnce({ ...mockDraftEval, status: "IN_PROGRESS" }) // transition to in_progress
        .mockResolvedValueOnce({
          ...mockDraftEval,
          status: "COMPLETED",
          completedAt: new Date(),
          profile: {
            id: "prof-1",
            averageMonthlyIncome: "6500.00",
            averageMonthlyExpenses: "2800.00",
            disposableIncome: "3700.00",
            totalDebt: "4200.00",
            activeCredits: 1,
            debtToIncome: "0.0692",
            hasRecentArrears: false,
            completeness: "1.0000",
            profileVersion: "1.0.0",
            calculatedAt: new Date(),
          },
          sourceResults: [
            {
              id: "sr-1",
              providerId: "p-bank",
              status: "SUCCESS",
              attemptCount: 1,
              externalReference: "BM-1234567-001",
              errorCode: null,
              requestedAt: new Date(),
              respondedAt: new Date(),
            },
          ],
        });

      mockBank.query.mockResolvedValueOnce({
        status: "SUCCESS",
        data: {
          documentNumber: "1234567",
          accounts: [],
          loans: [],
          reportedAt: "2026-10-10",
          currency: "BOB",
        },
        externalReference: "BM-1234567-001",
        providerId: "p-bank",
      });

      mockDb.client.evaluationSourceResult.findFirst.mockResolvedValueOnce(null);
      mockDb.client.evaluationSourceResult.upsert.mockResolvedValueOnce({
        id: "sr-1",
        status: "SUCCESS",
      });

      mockProfileCalculator.calculate.mockReturnValueOnce({
        averageMonthlyIncome: 6500,
        averageMonthlyExpenses: 2800,
        disposableIncome: 3700,
        totalDebt: 4200,
        activeCredits: 1,
        debtToIncome: 0.0692,
        hasRecentArrears: false,
        completeness: 1,
        profileVersion: "1.0.0",
      });

      mockProfileCalculator.saveProfile.mockResolvedValueOnce({
        id: "prof-1",
      });

      const res = await service.processEvaluation(makeContext(), "eval-1");

      expect(res.status).toBe("COMPLETED");
      expect(res.profile).toBeDefined();
      expect(res.profile?.averageMonthlyIncome).toBe(6500);
      expect(res.profile?.disposableIncome).toBe(3700);
      expect(res.sourceResults.length).toBe(1);
      expect(mockAudit.recordEvaluationProcessed).toHaveBeenCalledWith(
        expect.objectContaining({ status: "COMPLETED" }),
      );
    });

    it("PA-11.2: handles NO_DATA from Bank Mock by setting status to INCOMPLETE", async () => {
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce(mockDraftEval);
      mockDb.client.evaluation.update
        .mockResolvedValueOnce({ ...mockDraftEval, status: "IN_PROGRESS" })
        .mockResolvedValueOnce({
          ...mockDraftEval,
          status: "INCOMPLETE",
          failureCode: "NO_FINANCIAL_DATA",
          failureMessage: "La fuente bancaria no dispone de antecedentes financieros para el solicitante.",
          completedAt: new Date(),
          profile: null,
          sourceResults: [
            {
              id: "sr-1",
              providerId: "p-bank",
              status: "NO_DATA",
              attemptCount: 1,
              externalReference: "BM-1234567-002",
              errorCode: null,
              requestedAt: new Date(),
              respondedAt: new Date(),
            },
          ],
        });

      mockBank.query.mockResolvedValueOnce({
        status: "NO_DATA",
        message: "La fuente bancaria no dispone de antecedentes financieros para el solicitante.",
        externalReference: "BM-1234567-002",
        providerId: "p-bank",
      });

      mockDb.client.evaluationSourceResult.findFirst.mockResolvedValueOnce(null);
      mockDb.client.evaluationSourceResult.upsert.mockResolvedValueOnce({
        id: "sr-1",
        status: "NO_DATA",
      });

      const res = await service.processEvaluation(makeContext(), "eval-1");

      expect(res.status).toBe("INCOMPLETE");
      expect(res.failureCode).toBe("NO_FINANCIAL_DATA");
      expect(res.profile).toBeNull();
      expect(mockAudit.recordEvaluationProcessed).toHaveBeenCalledWith(
        expect.objectContaining({ status: "INCOMPLETE" }),
      );
    });

    it("PA-11.3 & PA-11.4: handles UNAVAILABLE/ERROR by setting status to FAILED (retryable)", async () => {
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce(mockDraftEval);
      mockDb.client.evaluation.update
        .mockResolvedValueOnce({ ...mockDraftEval, status: "IN_PROGRESS" })
        .mockResolvedValueOnce({
          ...mockDraftEval,
          status: "FAILED",
          failureCode: "BANK_UNAVAILABLE",
          failureMessage: "El servicio bancario externo no se encuentra disponible temporalmente.",
          profile: null,
          sourceResults: [
            {
              id: "sr-1",
              providerId: "p-bank",
              status: "UNAVAILABLE",
              attemptCount: 1,
              externalReference: null,
              errorCode: "BANK_UNAVAILABLE",
              requestedAt: new Date(),
              respondedAt: new Date(),
            },
          ],
        });

      mockBank.query.mockResolvedValueOnce({
        status: "UNAVAILABLE",
        message: "El servicio bancario externo no se encuentra disponible temporalmente.",
        errorCode: "BANK_UNAVAILABLE",
        retryable: true,
        providerId: "p-bank",
      });

      mockDb.client.evaluationSourceResult.findFirst.mockResolvedValueOnce(null);
      mockDb.client.evaluationSourceResult.upsert.mockResolvedValueOnce({
        id: "sr-1",
        status: "UNAVAILABLE",
      });

      const res = await service.processEvaluation(makeContext(), "eval-1");

      expect(res.status).toBe("FAILED");
      expect(res.failureCode).toBe("BANK_UNAVAILABLE");
      expect(mockAudit.recordEvaluationProcessed).toHaveBeenCalledWith(
        expect.objectContaining({ status: "FAILED" }),
      );
    });

    it("PA-11.5: re-attempting a failed evaluation reuses the same record and increments attemptCount", async () => {
      const existingFailedEval = {
        ...mockDraftEval,
        status: "FAILED",
        failureCode: "BANK_UNAVAILABLE",
      };
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce(existingFailedEval);
      mockDb.client.evaluation.update
        .mockResolvedValueOnce({ ...existingFailedEval, status: "IN_PROGRESS" })
        .mockResolvedValueOnce({
          ...existingFailedEval,
          status: "COMPLETED",
          profile: {
            id: "prof-1",
            averageMonthlyIncome: "5000",
            completeness: "1.0",
          },
          sourceResults: [
            {
              id: "sr-1",
              providerId: "p-bank",
              status: "SUCCESS",
              attemptCount: 2, // incremented
            },
          ],
        });

      mockBank.query.mockResolvedValueOnce({
        status: "SUCCESS",
        data: {
          documentNumber: "1234567",
          accounts: [],
          loans: [],
          reportedAt: "2026-10-10",
          currency: "BOB",
        },
        externalReference: "BM-1234567-retry",
        providerId: "p-bank",
      });

      // existing source result with attemptCount 1
      mockDb.client.evaluationSourceResult.findFirst.mockResolvedValueOnce({
        id: "sr-1",
        attemptCount: 1,
      });
      mockDb.client.evaluationSourceResult.upsert.mockResolvedValueOnce({
        id: "sr-1",
        status: "SUCCESS",
        attemptCount: 2,
      });

      mockProfileCalculator.calculate.mockReturnValueOnce({
        averageMonthlyIncome: 5000,
        completeness: 1,
        profileVersion: "1.0.0",
      });
      mockProfileCalculator.saveProfile.mockResolvedValueOnce({ id: "prof-1" });

      const res = await service.processEvaluation(makeContext(), "eval-1");

      expect(res.id).toBe("eval-1"); // same evaluation
      expect(res.status).toBe("COMPLETED");
      expect(mockDb.client.evaluationSourceResult.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ attemptCount: 2 }),
        }),
      );
    });
  });
});
