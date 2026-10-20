import { jest } from "@jest/globals";
import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { EvaluationsService } from "./evaluations.service.js";
import { DocumentTypeDto, CreditPurposeDto, ClientTypeDto } from "./dto/create-evaluation.dto.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import type { ClientsService } from "../clients/public.js";
import type { TenantPreparationService, TenantContext } from "../identity-tenants/public.js";
import type { AuditWriter } from "../audit/public.js";
import type { BankMockSource } from "../financial-integrations/public.js";
import type { ResilientSources } from "../financial-integrations/resilience/resilient-sources.js";
import type { FinancialProfileCalculator } from "../financial-profile/public.js";
import type { EvaluationRecommender } from "../recommendations/public.js";

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
        count: MockFn;
        create: MockFn;
        update: MockFn;
        updateMany: MockFn;
      };
      tenantSubscription: { findFirst: MockFn };
      usageRecord: { create: MockFn };
      evaluationSourceResult: {
        findFirst: MockFn;
        upsert: MockFn;
      };
      integrationProvider: {
        findUnique: MockFn;
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
  let mockBureau: {
    query: MockFn;
    status: MockFn;
    enable: MockFn;
  };
  let mockProfileCalculator: {
    calculate: MockFn;
    consolidate: MockFn;
    saveProfile: MockFn;
  };
  let mockRecommender: {
    evaluate: MockFn;
  };

  beforeEach(() => {
    mockDb = {
      client: {
        evaluation: {
          findUnique: jest.fn(),
          findFirst: jest.fn(),
          findMany: jest.fn(),
          count: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
          updateMany: jest.fn<any>().mockResolvedValue({ count: 1 }),
        },
        tenantSubscription: {
          findFirst: jest.fn<any>().mockResolvedValue({ id: "subscription-1" }),
        },
        usageRecord: {
          create: jest.fn<any>().mockResolvedValue({ id: "usage-1" }),
        },
        evaluationSourceResult: {
          findFirst: jest.fn(),
          upsert: jest.fn(),
        },
        integrationProvider: {
          findUnique: jest.fn<any>().mockImplementation((args: any) => {
            if (args?.where?.code === "BANK_MOCK") {
              return Promise.resolve({ id: "p-bank", code: "BANK_MOCK", name: "Banco Unión Mock" });
            }
            if (args?.where?.code === "BUREAU_MOCK") {
              return Promise.resolve({ id: "p-bureau", code: "BUREAU_MOCK", name: "Buró de Crédito Mock" });
            }
            return Promise.resolve(null);
          }),
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

    mockBureau = {
      query: jest.fn(),
      status: jest.fn<any>().mockResolvedValue({
        available: false,
        enabled: false,
        healthStatus: "INACTIVE",
      }),
      enable: jest.fn(),
    };

    mockProfileCalculator = {
      calculate: jest.fn(),
      consolidate: jest.fn<any>().mockReturnValue({
        indicators: {
          averageMonthlyIncome: 5000,
          completeness: 1,
          profileVersion: "1.0.0",
        },
        provenance: {
          averageMonthlyIncome: "BANK_MOCK",
          averageMonthlyExpenses: "BANK_MOCK",
          disposableIncome: "BANK_MOCK",
          totalDebt: "BANK_MOCK",
          activeCredits: "BANK_MOCK",
          debtToIncome: "BANK_MOCK",
          hasRecentArrears: "BANK_MOCK",
        },
      }),
      saveProfile: jest.fn(),
    };

    mockRecommender = {
      evaluate: jest.fn<any>().mockResolvedValue([]),
    };

    service = new EvaluationsService(
      mockDb as unknown as DatabaseUnitOfWork,
      mockClients as unknown as ClientsService,
      mockPreparation as unknown as TenantPreparationService,
      mockAudit as unknown as AuditWriter,
      mockBank as unknown as BankMockSource,
      mockBureau as unknown as any,
      mockProfileCalculator as unknown as FinancialProfileCalculator,
      mockRecommender as unknown as EvaluationRecommender,
      {
        queryBank: (_providerId: string | undefined, ...args: unknown[]) =>
          (mockBank.query as unknown as (...a: unknown[]) => unknown)(...args),
        queryBureau: (_providerId: string | undefined, ...args: unknown[]) =>
          (mockBureau.query as unknown as (...a: unknown[]) => unknown)(...args),
      } as unknown as ResilientSources,
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
          idempotencyKey: "ops01-reject-not-ready",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("does not grant evaluation access without an active contracted subscription", async () => {
      mockDb.client.evaluation.findUnique.mockResolvedValueOnce(null);
      mockDb.client.tenantSubscription.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.createDraft(makeContext(), {
          documentType: DocumentTypeDto.CI,
          documentNumber: "1234567",
          name: "Juan Perez",
          purpose: CreditPurposeDto.WORKING_CAPITAL,
          requestedAmount: 10000,
          consentGiven: true,
          idempotencyKey: "ops01-subscription-required",
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPreparation.read).not.toHaveBeenCalled();
      expect(mockDb.client.evaluation.create).not.toHaveBeenCalled();
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
        idempotencyKey: "ops01-personal-key-1",
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
        idempotencyKey: "ops01-personal-key-1",
      });

      expect(res.id).toBe("eval-1");
      expect(res.status).toBe("DRAFT");
      expect(mockAudit.recordEvaluationDraft).toHaveBeenCalled();
      expect(mockDb.client.evaluation.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId_idempotencyKey: {
              tenantId: "tenant-a",
              idempotencyKey: "ops01-personal-key-1",
            },
          },
        }),
      );
      expect(mockDb.client.evaluation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) }),
        }),
      );
    });

    it("returns the same evaluation for an equivalent replay without rechecking current readiness", async () => {
      const input = {
        documentType: DocumentTypeDto.CI,
        documentNumber: "1234567",
        name: "Juan Perez",
        purpose: CreditPurposeDto.WORKING_CAPITAL,
        requestedAmount: 10000,
        consentGiven: true,
        idempotencyKey: "ops01-same-intent-key",
      };
      const fingerprint = createHash("sha256")
        .update(
          JSON.stringify({
            operation: "evaluation.create",
            clientType: "PERSON",
            documentType: "CI",
            documentNumber: "1234567",
            name: "Juan Perez",
            economicActivity: null,
            purpose: "WORKING_CAPITAL",
            requestedAmount: "10000.00",
            consentGiven: true,
          }),
        )
        .digest("hex");
      const existing = {
        id: "eval-persisted",
        tenantId: "tenant-a",
        clientId: "client-1",
        purpose: "WORKING_CAPITAL",
        requestedAmount: 10000,
        status: "DRAFT",
        consentGivenAt: new Date(),
        applicantSnapshot: { name: "Juan Perez", documentType: "CI", documentNumber: "1234567" },
        requestFingerprint: fingerprint,
        createdAt: new Date(),
        updatedAt: new Date(),
        client: { name: "Juan Perez", documentType: "CI", documentNumber: "1234567" },
        profile: null,
        sourceResults: [],
      };
      mockDb.client.evaluation.findUnique.mockResolvedValueOnce(existing);

      const result = await service.createDraft(makeContext(), input);

      expect(result.id).toBe("eval-persisted");
      expect(mockDb.client.evaluation.create).not.toHaveBeenCalled();
      expect(mockPreparation.read).not.toHaveBeenCalled();
    });

    it("rejects reusing an operation key with a different business payload", async () => {
      mockDb.client.evaluation.findUnique.mockResolvedValueOnce({
        id: "eval-persisted",
        tenantId: "tenant-a",
        requestFingerprint: "f".repeat(64),
        client: { name: "Juan Perez", documentType: "CI", documentNumber: "1234567" },
        profile: null,
        sourceResults: [],
      });

      await expect(
        service.createDraft(makeContext(), {
          documentType: DocumentTypeDto.CI,
          documentNumber: "9999999",
          name: "Otra persona",
          purpose: CreditPurposeDto.WORKING_CAPITAL,
          requestedAmount: 10000,
          consentGiven: true,
          idempotencyKey: "ops01-conflict-same-key",
        }),
      ).rejects.toThrow(ConflictException);
      expect(mockDb.client.evaluation.create).not.toHaveBeenCalled();
    });
  });

  describe("HU-11: processEvaluation()", () => {
    const mockDraftEval = {
      id: "eval-1",
      tenantId: "tenant-a",
      clientId: "client-1",
      documentNumber: "1234567",
      purpose: "WORKING_CAPITAL",
      requestedAmount: 15000,
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

    it("does not run duplicate source work when another request wins the persisted claim", async () => {
      mockDb.client.evaluation.findFirst
        .mockResolvedValueOnce(mockDraftEval)
        .mockResolvedValueOnce({ ...mockDraftEval, status: "IN_PROGRESS" });
      mockDb.client.evaluation.updateMany.mockResolvedValueOnce({ count: 0 });

      const result = await service.processEvaluation(makeContext(), "eval-1");

      expect(result.status).toBe("IN_PROGRESS");
      expect(mockBank.query).not.toHaveBeenCalled();
      expect(mockBureau.query).not.toHaveBeenCalled();
      expect(mockDb.client.usageRecord.create).not.toHaveBeenCalled();
    });

    it("PA-11.1: processes successfully, creates profile and completes evaluation", async () => {
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce(mockDraftEval);
      mockDb.client.evaluation.update.mockResolvedValueOnce({
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
      expect(mockDb.client.usageRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: "tenant-a",
          metric: "EVALUATION",
          quantity: 1,
          referenceType: "Evaluation",
          referenceId: "eval-1",
          idempotencyKey: "evaluation-completed/eval-1",
        }),
      });
      expect(res.profile).toBeDefined();
      expect(res.profile?.averageMonthlyIncome).toBe(6500);
      expect(res.profile?.disposableIncome).toBe(3700);
      expect(res.sourceResults.length).toBe(1);
      expect(mockRecommender.evaluate).toHaveBeenCalledWith(
        "tenant-a",
        "eval-1",
        expect.objectContaining({
          applicantScope: "PERSON",
          purpose: "WORKING_CAPITAL",
          requestedAmount: 15000,
        }),
      );
      expect(mockAudit.recordEvaluationProcessed).toHaveBeenCalledWith(
        expect.objectContaining({ status: "COMPLETED" }),
      );
    });

    it("PA-11.2: handles NO_DATA from Bank Mock by setting status to INCOMPLETE", async () => {
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce(mockDraftEval);
      mockDb.client.evaluation.update.mockResolvedValueOnce({
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
      expect(mockDb.client.usageRecord.create).not.toHaveBeenCalled();
      expect(mockAudit.recordEvaluationProcessed).toHaveBeenCalledWith(
        expect.objectContaining({ status: "INCOMPLETE" }),
      );
    });

    it("PA-11.3 & PA-11.4: handles UNAVAILABLE/ERROR by setting status to FAILED (retryable)", async () => {
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce(mockDraftEval);
      mockDb.client.evaluation.update.mockResolvedValueOnce({
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
      expect(mockDb.client.usageRecord.create).not.toHaveBeenCalled();
      expect(mockAudit.recordEvaluationProcessed).toHaveBeenCalledWith(
        expect.objectContaining({ status: "FAILED" }),
      );
    });

    it("PA-11.5: re-attempting a failed evaluation reuses the same record and increments attemptCount", async () => {
      const existingFailedEval = {
        ...mockDraftEval,
        status: "FAILED",
        failureCode: "BANK_UNAVAILABLE",
        sourceResults: [
          {
            id: "sr-1",
            providerId: "p-bank",
            provider: { code: "BANK_MOCK", name: "Bank Mock" },
            status: "FAILED",
            attemptCount: 1,
          },
        ],
      };
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce(existingFailedEval);
      mockDb.client.evaluation.update.mockResolvedValueOnce({
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

  describe("HU-14 — Preparar evaluaciones crediticias de empresas desde el flujo existente", () => {
    it("PA-14.01: searches client with clientType COMPANY and reuses existing dossier within tenant", async () => {
      mockClients.findByDocument.mockResolvedValueOnce({
        id: "client-comp-1",
        name: "Tecnología Los Andes S.R.L.",
        documentType: "NIT",
        documentNumber: "1020304050",
        type: "COMPANY",
        economicActivity: "Servicios de Software",
      });

      const res = await service.searchClient(
        makeContext({ tenantId: "tenant-a" }),
        DocumentTypeDto.NIT,
        "1020304050",
        ClientTypeDto.COMPANY,
      );

      expect(mockClients.findByDocument).toHaveBeenCalledWith(
        "tenant-a",
        DocumentTypeDto.NIT,
        "1020304050",
        ClientTypeDto.COMPANY,
      );
      expect(res).toEqual({
        id: "client-comp-1",
        name: "Tecnología Los Andes S.R.L.",
        documentType: "NIT",
        documentNumber: "1020304050",
        type: "COMPANY",
        economicActivity: "Servicios de Software",
      });
    });

    it("PA-14.05: cross-tenant search preserves tenant isolation and does not return other tenant dossier", async () => {
      mockClients.findByDocument.mockResolvedValueOnce(null);

      const res = await service.searchClient(
        makeContext({ tenantId: "tenant-b" }),
        DocumentTypeDto.NIT,
        "1020304050",
        ClientTypeDto.COMPANY,
      );

      expect(mockClients.findByDocument).toHaveBeenCalledWith(
        "tenant-b",
        DocumentTypeDto.NIT,
        "1020304050",
        ClientTypeDto.COMPANY,
      );
      expect(res).toBeNull();
    });

    it("PA-14.04: rejects draft creation when tenant does not have active company products", async () => {
      mockPreparation.read.mockResolvedValueOnce({
        ready: true,
        completed: 3,
        percentage: 100,
        steps: { institution: true, source: true, products: true },
        tenant: { name: "Banco A" },
        source: { enabled: true },
        products: [{ selected: true, applicantScope: "PERSON" }],
      });

      await expect(
        service.createDraft(makeContext(), {
          clientType: ClientTypeDto.COMPANY,
          documentType: DocumentTypeDto.NIT,
          documentNumber: "1020304050",
          name: "Empresa Sin Cobertura S.R.L.",
          economicActivity: "Comercio",
          purpose: CreditPurposeDto.WORKING_CAPITAL,
          requestedAmount: 50000,
          consentGiven: true,
          idempotencyKey: "ops01-company-no-scope",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("PA-14.02 & PA-14.03: creates company evaluation draft with tailored consent and economic activity", async () => {
      mockPreparation.read.mockResolvedValueOnce({
        ready: true,
        completed: 3,
        percentage: 100,
        steps: { institution: true, source: true, products: true },
        tenant: { name: "Banco A" },
        source: { enabled: true },
        products: [{ selected: true, applicantScope: "COMPANY" }],
      });
      mockDb.client.evaluation.findUnique.mockResolvedValueOnce(null);

      mockClients.findOrCreate.mockResolvedValueOnce({
        client: {
          id: "client-comp-2",
          type: "COMPANY",
          documentType: "NIT",
          documentNumber: "1020304050",
          name: "Soluciones Industriales S.A.",
          economicActivity: "Fabricación",
        },
        created: true,
      });

      mockDb.client.evaluation.create.mockResolvedValueOnce({
        id: "eval-comp-1",
        tenantId: "tenant-a",
        clientId: "client-comp-2",
        status: "DRAFT",
        purpose: "WORKING_CAPITAL",
        requestedAmount: 75000,
        applicantSnapshot: {
          id: "client-comp-2",
          type: "COMPANY",
          name: "Soluciones Industriales S.A.",
          documentNumber: "1020304050",
          economicActivity: "Fabricación",
          consent: {
            statement:
              "La empresa solicitante autoriza formalmente la consulta, verificación de antecedentes financieros y procesamiento de evaluación crediticia institucional.",
          },
        },
        client: {
          id: "client-comp-2",
          type: "COMPANY",
          name: "Soluciones Industriales S.A.",
          documentNumber: "1020304050",
          economicActivity: "Fabricación",
        },
        profile: null,
        sourceResults: [],
        recommendations: [],
      });

      const res = await service.createDraft(makeContext(), {
        clientType: ClientTypeDto.COMPANY,
        documentType: DocumentTypeDto.NIT,
        documentNumber: "1020304050",
        name: "Soluciones Industriales S.A.",
        economicActivity: "Fabricación",
        purpose: CreditPurposeDto.WORKING_CAPITAL,
        requestedAmount: 75000,
        consentGiven: true,
        idempotencyKey: "ops01-create-company-case",
      });

      expect(res.id).toBe("eval-comp-1");
      expect(mockClients.findOrCreate).toHaveBeenCalledWith("tenant-a", {
        type: "COMPANY",
        documentType: "NIT",
        documentNumber: "1020304050",
        name: "Soluciones Industriales S.A.",
        economicActivity: "Fabricación",
      });
      expect(mockDb.client.evaluation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            applicantSnapshot: expect.objectContaining({
              type: "COMPANY",
              economicActivity: "Fabricación",
              consent: expect.objectContaining({
                statement: expect.stringContaining("La empresa solicitante autoriza"),
              }),
            }),
          }),
        }),
      );
    });

    it("evaluates company with applicantScope COMPANY in recommendation service", async () => {
      mockPreparation.read.mockResolvedValueOnce({
        ready: true,
        completed: 3,
        percentage: 100,
        steps: { institution: true, source: true, products: true },
        tenant: { name: "Banco A" },
        source: { enabled: true },
        products: [{ selected: true, applicantScope: "COMPANY" }],
      });

      mockDb.client.evaluation.findFirst.mockResolvedValueOnce({
        id: "eval-comp-2",
        tenantId: "tenant-a",
        status: "DRAFT",
        purpose: "WORKING_CAPITAL",
        requestedAmount: 60000,
        consentGivenAt: new Date(),
        applicantSnapshot: { type: "COMPANY" },
        client: {
          id: "client-comp-2",
          type: "COMPANY",
          documentType: "NIT",
          documentNumber: "1020304050",
        },
        sourceResults: [],
        recommendations: [],
      });

      mockDb.client.evaluation.update.mockResolvedValueOnce({
        id: "eval-comp-2",
        status: "COMPLETED",
        client: { id: "client-comp-2", type: "COMPANY" },
        profile: { id: "prof-comp" },
        sourceResults: [{ id: "sr-comp", status: "SUCCESS" }],
      });

      mockBank.query.mockResolvedValueOnce({
        status: "SUCCESS",
        data: {
          documentNumber: "1020304050",
          accounts: [],
          loans: [],
          reportedAt: "2026-10-10",
          currency: "BOB",
        },
        externalReference: "BM-1020304050",
        providerId: "p-bank",
      });

      mockDb.client.evaluationSourceResult.findFirst.mockResolvedValueOnce(null);
      mockDb.client.evaluationSourceResult.upsert.mockResolvedValueOnce({
        id: "sr-comp",
        status: "SUCCESS",
      });

      mockProfileCalculator.calculate.mockReturnValueOnce({
        averageMonthlyIncome: 30000,
        completeness: 1,
        profileVersion: "1.0.0",
      });
      mockProfileCalculator.saveProfile.mockResolvedValueOnce({ id: "prof-comp" });

      await service.processEvaluation(makeContext(), "eval-comp-2");

      expect(mockRecommender.evaluate).toHaveBeenCalledWith(
        "tenant-a",
        "eval-comp-2",
        expect.objectContaining({
          applicantScope: "COMPANY",
          purpose: "WORKING_CAPITAL",
          requestedAmount: 60000,
        }),
      );
    });
  });

  describe("HU-15 — Procesar Banco y Buró con procedencia y estados comprensibles", () => {
    it("PA-15.01: queries both Bank and Buró when Buró is enabled, consolidates profile and links both sources", async () => {
      mockPreparation.read.mockResolvedValueOnce({
        ready: true,
        source: { enabled: true },
        steps: { source: true, products: true },
        products: [{ selected: true, applicantScope: "PERSON" }],
      });

      mockBureau.status.mockResolvedValueOnce({
        available: true,
        enabled: true,
        healthStatus: "ACTIVE",
      });

      mockDb.client.evaluation.findFirst.mockResolvedValueOnce({
        id: "eval-multi-1",
        tenantId: "tenant-a",
        clientId: "client-1",
        purpose: "HOME_IMPROVEMENT",
        requestedAmount: "25000",
        status: "PREPARED",
        consentGivenAt: new Date(),
        applicantSnapshot: { type: "PERSON", documentNumber: "1234567" },
        client: { documentNumber: "1234567", type: "PERSON" },
        sourceResults: [],
        recommendations: [],
      });

      mockDb.client.evaluation.update.mockResolvedValueOnce({
        id: "eval-multi-1",
        status: "COMPLETED",
        profile: { id: "prof-multi-1" },
        sourceResults: [
          { id: "sr-bank-1", provider: { code: "BANK_MOCK", name: "Banco Unión Mock" }, status: "SUCCESS" },
          {
            id: "sr-bureau-1",
            provider: { code: "BUREAU_MOCK", name: "Buró de Crédito Mock" },
            status: "SUCCESS",
          },
        ],
      });

      mockBank.query.mockResolvedValueOnce({
        status: "SUCCESS",
        data: { documentNumber: "1234567", accounts: [], loans: [] },
        providerId: "p-bank",
      });

      mockBureau.query.mockResolvedValueOnce({
        status: "SUCCESS",
        data: { documentNumber: "1234567", totalSystemDebt: 15000, activeCreditsCount: 1 },
        providerId: "p-bureau",
      });

      mockDb.client.evaluationSourceResult.upsert
        .mockResolvedValueOnce({ id: "sr-bank-1", status: "SUCCESS" })
        .mockResolvedValueOnce({ id: "sr-bureau-1", status: "SUCCESS" });

      mockProfileCalculator.saveProfile.mockResolvedValueOnce({ id: "prof-multi-1" });

      const res = await service.processEvaluation(makeContext(), "eval-multi-1");

      expect(mockBank.query).toHaveBeenCalledWith("tenant-a", "1234567", "PERSON");
      expect(mockBureau.query).toHaveBeenCalledWith("tenant-a", "1234567");
      expect(mockProfileCalculator.consolidate).toHaveBeenCalledWith(
        expect.objectContaining({
          bankData: expect.any(Object),
          bureauData: expect.any(Object),
        }),
      );
      expect(mockProfileCalculator.saveProfile).toHaveBeenCalledWith(
        "tenant-a",
        "eval-multi-1",
        ["sr-bank-1", "sr-bureau-1"],
        expect.any(Object),
      );
      expect(res.status).toBe("COMPLETED");
    });

    it("PA-15.02: reuses previously successful Bank result during retry without re-querying it (CA-15.10)", async () => {
      mockPreparation.read.mockResolvedValueOnce({
        ready: true,
        source: { enabled: true },
        steps: { source: true, products: true },
        products: [{ selected: true, applicantScope: "PERSON" }],
      });

      mockBureau.status.mockResolvedValueOnce({
        available: true,
        enabled: true,
        healthStatus: "ACTIVE",
      });

      // Evaluation was previously FAILED because Buró timed out, but Bank had succeeded
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce({
        id: "eval-retry-1",
        tenantId: "tenant-a",
        clientId: "client-1",
        purpose: "CONSUMER",
        requestedAmount: "10000",
        status: "FAILED",
        consentGivenAt: new Date(),
        applicantSnapshot: { type: "PERSON", documentNumber: "1234567" },
        client: { documentNumber: "1234567", type: "PERSON" },
        sourceResults: [
          {
            id: "sr-bank-prev",
            providerId: "p-bank",
            provider: { code: "BANK_MOCK", name: "Banco Unión Mock" },
            status: "SUCCESS",
            attemptCount: 1,
            normalizedPayload: { documentNumber: "1234567", accounts: [] },
          },
          {
            id: "sr-bureau-prev",
            providerId: "p-bureau",
            provider: { code: "BUREAU_MOCK", name: "Buró de Crédito Mock" },
            status: "UNAVAILABLE",
            attemptCount: 1,
          },
        ],
        recommendations: [],
      });

      mockDb.client.evaluation.update.mockResolvedValueOnce({
        id: "eval-retry-1",
        status: "COMPLETED",
        profile: { id: "prof-retry-1" },
        sourceResults: [
          { id: "sr-bank-prev", provider: { code: "BANK_MOCK" }, status: "SUCCESS" },
          { id: "sr-bureau-prev", provider: { code: "BUREAU_MOCK" }, status: "SUCCESS" },
        ],
      });

      // Buró is retried successfully this time
      mockBureau.query.mockResolvedValueOnce({
        status: "SUCCESS",
        data: { documentNumber: "1234567", totalSystemDebt: 8000 },
        providerId: "p-bureau",
      });

      mockDb.client.evaluationSourceResult.upsert.mockResolvedValueOnce({
        id: "sr-bureau-prev",
        status: "SUCCESS",
        attemptCount: 2,
      });

      mockProfileCalculator.saveProfile.mockResolvedValueOnce({ id: "prof-retry-1" });

      const res = await service.processEvaluation(makeContext(), "eval-retry-1");

      // Bank must NOT be re-queried
      expect(mockBank.query).not.toHaveBeenCalled();
      // Buró is retried
      expect(mockBureau.query).toHaveBeenCalledWith("tenant-a", "1234567");
      expect(res.status).toBe("COMPLETED");
    });

    it("PA-15.03: handles Buró technical failure by marking evaluation FAILED with retry allowed (CA-15.07)", async () => {
      mockPreparation.read.mockResolvedValueOnce({
        ready: true,
        source: { enabled: true },
        steps: { source: true, products: true },
        products: [{ selected: true, applicantScope: "PERSON" }],
      });

      mockBureau.status.mockResolvedValueOnce({
        available: true,
        enabled: true,
        healthStatus: "ACTIVE",
      });

      mockDb.client.evaluation.findFirst.mockResolvedValueOnce({
        id: "eval-fail-1",
        tenantId: "tenant-a",
        clientId: "client-1",
        purpose: "CONSUMER",
        requestedAmount: "10000",
        status: "PREPARED",
        consentGivenAt: new Date(),
        applicantSnapshot: { type: "PERSON", documentNumber: "1234999" },
        client: { documentNumber: "1234999", type: "PERSON" },
        sourceResults: [],
        recommendations: [],
      });

      mockDb.client.evaluation.update.mockResolvedValueOnce({
        id: "eval-fail-1",
        status: "FAILED",
        failureCode: "BUREAU_UNAVAILABLE",
        failureMessage: "Buró de Crédito no está disponible temporalmente.",
        sourceResults: [
          { id: "sr-bank-1", provider: { code: "BANK_MOCK" }, status: "SUCCESS" },
          { id: "sr-bureau-1", provider: { code: "BUREAU_MOCK" }, status: "UNAVAILABLE" },
        ],
      });

      mockBank.query.mockResolvedValueOnce({
        status: "SUCCESS",
        data: { documentNumber: "1234999", accounts: [] },
        providerId: "p-bank",
      });

      mockBureau.query.mockResolvedValueOnce({
        status: "UNAVAILABLE",
        errorCode: "BUREAU_UNAVAILABLE",
        message: "Buró de Crédito no disponible temporalmente.",
        retryable: true,
        providerId: "p-bureau",
      });

      mockDb.client.evaluationSourceResult.upsert
        .mockResolvedValueOnce({ id: "sr-bank-1", status: "SUCCESS" })
        .mockResolvedValueOnce({ id: "sr-bureau-1", status: "UNAVAILABLE" });

      const res = await service.processEvaluation(makeContext(), "eval-fail-1");

      expect(res.status).toBe("FAILED");
      expect(res.failureCode).toBe("BUREAU_UNAVAILABLE");
      expect(mockProfileCalculator.saveProfile).not.toHaveBeenCalled();
      expect(mockRecommender.evaluate).not.toHaveBeenCalled();
    });

    it("PA-15.04: handles Buró NO_DATA alongside Bank SUCCESS completing evaluation normally (CA-15.06)", async () => {
      mockPreparation.read.mockResolvedValueOnce({
        ready: true,
        source: { enabled: true },
        steps: { source: true, products: true },
        products: [{ selected: true, applicantScope: "PERSON" }],
      });

      mockBureau.status.mockResolvedValueOnce({
        available: true,
        enabled: true,
        healthStatus: "ACTIVE",
      });

      mockDb.client.evaluation.findFirst.mockResolvedValueOnce({
        id: "eval-nodata-1",
        tenantId: "tenant-a",
        clientId: "client-1",
        purpose: "CONSUMER",
        requestedAmount: "10000",
        status: "PREPARED",
        consentGivenAt: new Date(),
        applicantSnapshot: { type: "PERSON", documentNumber: "1234000" },
        client: { documentNumber: "1234000", type: "PERSON" },
        sourceResults: [],
        recommendations: [],
      });

      mockDb.client.evaluation.update.mockResolvedValueOnce({
        id: "eval-nodata-1",
        status: "COMPLETED",
        profile: { id: "prof-nodata-1" },
        sourceResults: [
          { id: "sr-bank-1", provider: { code: "BANK_MOCK" }, status: "SUCCESS" },
          { id: "sr-bureau-1", provider: { code: "BUREAU_MOCK" }, status: "NO_DATA" },
        ],
      });

      mockBank.query.mockResolvedValueOnce({
        status: "SUCCESS",
        data: { documentNumber: "1234000", accounts: [] },
        providerId: "p-bank",
      });

      mockBureau.query.mockResolvedValueOnce({
        status: "NO_DATA",
        message: "No se encontraron registros de crédito en el Buró.",
        providerId: "p-bureau",
      });

      mockDb.client.evaluationSourceResult.upsert
        .mockResolvedValueOnce({ id: "sr-bank-1", status: "SUCCESS" })
        .mockResolvedValueOnce({ id: "sr-bureau-1", status: "NO_DATA" });

      mockProfileCalculator.saveProfile.mockResolvedValueOnce({ id: "prof-nodata-1" });

      const res = await service.processEvaluation(makeContext(), "eval-nodata-1");

      expect(res.status).toBe("COMPLETED");
      expect(mockProfileCalculator.consolidate).toHaveBeenCalledWith(
        expect.objectContaining({
          bankData: expect.any(Object),
          bureauData: null,
        }),
      );
      expect(mockRecommender.evaluate).toHaveBeenCalled();
    });
  });

  describe("HU-17 — Recomendaciones explicables y conservación histórica (PA-17.06, CA-17.10)", () => {
    it("PA-17.06: preserves historical recommendations, ruleVersion and reasons frozen without re-evaluating", async () => {
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce({
        id: "eval-hist-1",
        tenantId: "tenant-a",
        clientId: "client-1",
        purpose: "WORKING_CAPITAL",
        requestedAmount: "25000",
        status: "COMPLETED",
        ruleVersion: "1.0.0",
        consentGivenAt: new Date("2026-10-01T10:00:00Z"),
        createdAt: new Date("2026-10-01T10:00:00Z"),
        updatedAt: new Date("2026-10-01T10:05:00Z"),
        applicantSnapshot: { type: "COMPANY", name: "Empresa Andina SRL", documentNumber: "10203040" },
        client: { name: "Empresa Andina SRL", documentType: "NIT", documentNumber: "10203040" },
        profile: {
          id: "prof-hist-1",
          averageMonthlyIncome: "50000",
          averageMonthlyExpenses: "20000",
          disposableIncome: "30000",
          totalDebt: "15000",
          activeCredits: 1,
          debtToIncome: "0.25",
          hasRecentArrears: false,
          completeness: "1.0",
          profileVersion: "1.0.0",
          calculatedAt: new Date("2026-10-01T10:05:00Z"),
        },
        sourceResults: [
          {
            id: "sr-1",
            providerId: "p-bank",
            provider: { code: "BANK_MOCK", name: "Banco Unión Mock" },
            status: "SUCCESS",
            attemptCount: 1,
            requestedAt: new Date(),
            respondedAt: new Date(),
          },
        ],
        recommendations: [
          {
            id: "rec-hist-1",
            productId: "prod-empresa-1",
            outcome: "RECOMMENDED",
            ruleVersion: "1.0.0",
            evaluatedAt: new Date("2026-10-01T10:05:00Z"),
            product: {
              name: "Pyme Productivo",
              category: "SME_CREDIT",
              minAmount: "10000",
              maxAmount: "100000",
            },
            reasons: [
              { code: "RULE_APPLICANT_SCOPE", message: "Producto habilitado para empresas.", passed: true },
              { code: "RULE_PURPOSE", message: "Finalidad admitida.", passed: true },
            ],
          },
          {
            id: "rec-hist-2",
            productId: "prod-empresa-2",
            outcome: "NOT_COMPATIBLE",
            ruleVersion: "1.0.0",
            evaluatedAt: new Date("2026-10-01T10:05:00Z"),
            product: {
              name: "Crédito Verde Empresa",
              category: "GREEN_CREDIT",
              minAmount: "50000",
              maxAmount: "200000",
            },
            reasons: [
              {
                code: "RULE_MAX_DTI_NOT_EVALUABLE",
                message: "No se pudo evaluar la relación deuda/ingreso. Condición no comprobada.",
                passed: false,
              },
            ],
          },
        ],
      });

      const res = await service.getById(makeContext(), "eval-hist-1");

      expect(res.id).toBe("eval-hist-1");
      expect(res.ruleVersion).toBe("1.0.0");
      expect(res.recommendations).toHaveLength(2);

      // Rec 1: RECOMMENDED -> COMPATIBLE
      expect(res.recommendations[0].outcome).toBe("RECOMMENDED");
      expect(res.recommendations[0].compatibilityStatus).toBe("COMPATIBLE");
      expect(res.recommendations[0].productName).toBe("Pyme Productivo");

      // Rec 2: UNEVALUABLE reasons map to NOT_EVALUABLE (PA-17.04, CA-17.05)
      expect(res.recommendations[1].outcome).toBe("NOT_EVALUABLE");
      expect(res.recommendations[1].compatibilityStatus).toBe("NOT_EVALUABLE");
      expect(res.recommendations[1].reasons[0].status).toBe("NOT_EVALUABLE");

      // Verify recommender was NOT re-executed
      expect(mockRecommender.evaluate).not.toHaveBeenCalled();
    });
  });

  describe("HU-18 Consultar historial y estados de evaluaciones de la institución", () => {
    it("PA-18.01 & CA-18.05 & CA-18.11: retrieves historical evaluation without altering state or re-calculating", async () => {
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce({
        id: "eval-hist-2",
        tenantId: "tenant-a",
        purpose: "WORKING_CAPITAL",
        requestedAmount: 25000,
        status: "COMPLETED",
        ruleVersion: "1.0.0",
        createdAt: new Date("2026-09-01T10:00:00.000Z"),
        client: {
          id: "client-2",
          name: "Roberto Gomez",
          documentType: "CI",
          documentNumber: "6543210",
        },
        profile: {
          id: "prof-hist-2",
          averageMonthlyIncome: 8000,
          averageMonthlyExpenses: 3000,
          disposableIncome: 5000,
          totalDebt: 2000,
          activeCredits: 1,
          debtToIncome: 0.05,
          hasRecentArrears: false,
          completeness: 1,
          profileVersion: "1.0.0",
          calculatedAt: new Date("2026-09-01T10:05:00.000Z"),
        },
        sourceResults: [],
        recommendations: [],
      });

      const res = await service.getById(makeContext({ tenantId: "tenant-a" }), "eval-hist-2");

      expect(res.id).toBe("eval-hist-2");
      expect(res.clientName).toBe("Roberto Gomez");
      expect(res.status).toBe("COMPLETED");
      // Assert no modifications or re-runs
      expect(mockDb.client.evaluation.update).not.toHaveBeenCalled();
      expect(mockRecommender.evaluate).not.toHaveBeenCalled();
      expect(mockBank.query).not.toHaveBeenCalled();
      expect(mockBureau.query).not.toHaveBeenCalled();
    });

    it("PA-18.02 & CA-18.02 & CA-18.08: lists evaluations with search, status filters, and pagination envelope", async () => {
      mockDb.client.evaluation.count.mockResolvedValueOnce(25);
      mockDb.client.evaluation.findMany.mockResolvedValueOnce([
        {
          id: "eval-p1",
          tenantId: "tenant-a",
          purpose: "WORKING_CAPITAL",
          requestedAmount: 10000,
          status: "COMPLETED",
          ruleVersion: "1.0.0",
          createdAt: new Date("2026-10-10T12:00:00.000Z"),
          client: {
            id: "c-1",
            name: "Maria Lopez",
            documentType: "CI",
            documentNumber: "1234567",
          },
          profile: null,
          sourceResults: [],
          recommendations: [],
        },
      ]);

      const res = await service.list(makeContext({ tenantId: "tenant-a" }), {
        search: "Maria",
        status: "COMPLETED",
        page: 2,
        limit: 10,
      });

      expect(res.total).toBe(25);
      expect(res.page).toBe(2);
      expect(res.limit).toBe(10);
      expect(res.totalPages).toBe(3);
      expect(res.items).toHaveLength(1);
      expect(res.items[0].clientName).toBe("Maria Lopez");

      // Verify Prisma query arguments
      expect(mockDb.client.evaluation.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          tenantId: "tenant-a",
          status: "COMPLETED",
          OR: [
            { client: { name: { contains: "Maria", mode: "insensitive" } } },
            { client: { documentNumber: { contains: "Maria", mode: "insensitive" } } },
          ],
        }),
      });

      expect(mockDb.client.evaluation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
          orderBy: { createdAt: "desc" },
        }),
      );
    });

    it("PA-18.06 & CA-18.10: denies direct URL access to evaluations belonging to another tenant without leaking metadata", async () => {
      // Evaluation exists in Banco Y ("tenant-b"), but Carlos is authenticated in Banco X ("tenant-a")
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.getById(makeContext({ tenantId: "tenant-a" }), "eval-of-tenant-b"),
      ).rejects.toThrow(NotFoundException);

      expect(mockDb.client.evaluation.findFirst).toHaveBeenCalledWith({
        where: { id: "eval-of-tenant-b", tenantId: "tenant-a" },
        include: expect.any(Object),
      });
    });
  });
});
