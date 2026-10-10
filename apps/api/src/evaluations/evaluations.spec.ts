import { jest } from "@jest/globals";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { EvaluationsService } from "./evaluations.service.js";
import { DocumentTypeDto, CreditPurposeDto } from "./dto/create-evaluation.dto.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import type { ClientsService } from "../clients/public.js";
import type { TenantPreparationService, TenantContext } from "../identity-tenants/public.js";
import type { AuditWriter } from "../audit/public.js";

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

describe("EvaluationsService (HU-10)", () => {
  let service: EvaluationsService;
  let mockDb: {
    client: {
      evaluation: {
        findUnique: MockFn;
        findFirst: MockFn;
        findMany: MockFn;
        create: MockFn;
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
  };

  beforeEach(() => {
    mockDb = {
      client: {
        evaluation: {
          findUnique: jest.fn(),
          findFirst: jest.fn(),
          findMany: jest.fn(),
          create: jest.fn(),
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
    };

    service = new EvaluationsService(
      mockDb as unknown as DatabaseUnitOfWork,
      mockClients as unknown as ClientsService,
      mockPreparation as unknown as TenantPreparationService,
      mockAudit as unknown as AuditWriter,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("Readiness check", () => {
    it("reports ready=false when tenant preparation is incomplete", async () => {
      mockPreparation.read.mockResolvedValueOnce({
        ready: false,
        completed: 2,
        percentage: 67,
        steps: { institution: true, source: true, products: false },
        tenant: { name: "Banco A" },
      });

      const result = await service.checkReadiness(makeContext());
      expect(result.ready).toBe(false);
      expect(result.percentage).toBe(67);
      expect(result.steps.products).toBe(false);
    });

    it("reports ready=true when all 3 preparation steps are confirmed", async () => {
      mockPreparation.read.mockResolvedValueOnce({
        ready: true,
        completed: 3,
        percentage: 100,
        steps: { institution: true, source: true, products: true },
        tenant: { name: "Banco A" },
      });

      const result = await service.checkReadiness(makeContext());
      expect(result.ready).toBe(true);
      expect(result.percentage).toBe(100);
    });
  });

  describe("Creating evaluation draft (HU-10)", () => {
    it("rejects creation if tenant is not ready", async () => {
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

    it("rejects creation if simulated consent is missing", async () => {
      mockPreparation.read.mockResolvedValueOnce({
        ready: true,
        completed: 3,
        percentage: 100,
        steps: { institution: true, source: true, products: true },
        tenant: { name: "Banco A" },
      });

      await expect(
        service.createDraft(makeContext(), {
          documentType: DocumentTypeDto.CI,
          documentNumber: "1234567",
          name: "Juan Perez",
          purpose: CreditPurposeDto.WORKING_CAPITAL,
          requestedAmount: 10000,
          consentGiven: false,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("creates an evaluation in DRAFT status and freezes applicantSnapshot with consent evidence", async () => {
      const ctx = makeContext();
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

      const createdEval = {
        id: "eval-1",
        tenantId: ctx.tenantId,
        clientId: "client-1",
        createdByMembershipId: ctx.membershipId,
        idempotencyKey: "test-key-1",
        purpose: "WORKING_CAPITAL",
        requestedAmount: "15000.00",
        status: "DRAFT",
        consentGivenAt: new Date("2026-10-10T12:00:00Z"),
        applicantSnapshot: {
          id: "client-1",
          type: "PERSON",
          documentType: "CI",
          documentNumber: "1234567",
          name: "Juan Perez",
          consent: { given: true },
        },
        ruleVersion: "1.0.0",
        createdAt: new Date("2026-10-10T12:00:00Z"),
        updatedAt: new Date("2026-10-10T12:00:00Z"),
        client: { name: "Juan Perez", documentType: "CI", documentNumber: "1234567" },
      };

      mockDb.client.evaluation.create.mockResolvedValueOnce(createdEval);

      const result = await service.createDraft(ctx, {
        documentType: DocumentTypeDto.CI,
        documentNumber: "1234567",
        name: "Juan Perez",
        purpose: CreditPurposeDto.WORKING_CAPITAL,
        requestedAmount: 15000,
        consentGiven: true,
        idempotencyKey: "test-key-1",
      });

      expect(result.id).toBe("eval-1");
      expect(result.status).toBe("DRAFT");
      expect(result.requestedAmount).toBe(15000);
      expect(result.clientName).toBe("Juan Perez");
      expect(mockAudit.recordEvaluationDraft).toHaveBeenCalledWith({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        evaluationId: "eval-1",
      });
    });

    it("enforces tenant boundary on idempotency lookup", async () => {
      const ctx = makeContext({ tenantId: "tenant-a" });
      mockPreparation.read.mockResolvedValueOnce({
        ready: true,
        completed: 3,
        percentage: 100,
        steps: { institution: true, source: true, products: true },
        tenant: { name: "Banco A" },
      });

      // Evaluation belongs to a different tenant!
      mockDb.client.evaluation.findUnique.mockResolvedValueOnce({
        id: "eval-b",
        tenantId: "tenant-b",
        idempotencyKey: "key-collision",
      });

      await expect(
        service.createDraft(ctx, {
          documentType: DocumentTypeDto.CI,
          documentNumber: "1234567",
          name: "Juan Perez",
          purpose: CreditPurposeDto.WORKING_CAPITAL,
          requestedAmount: 15000,
          consentGiven: true,
          idempotencyKey: "key-collision",
        }),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
