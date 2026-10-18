import { jest } from "@jest/globals";
import { BadRequestException } from "@nestjs/common";
import { EvaluationsService } from "./evaluations.service.js";
import { ClientTypeDto, CreditPurposeDto, DocumentTypeDto } from "./dto/create-evaluation.dto.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import type { ClientsService } from "../clients/public.js";
import type { TenantContext, TenantPreparationService } from "../identity-tenants/public.js";
import type { AuditWriter } from "../audit/public.js";
import type { BankMockSource } from "../financial-integrations/public.js";
import type { ResilientSources } from "../financial-integrations/resilience/resilient-sources.js";
import type { FinancialProfileCalculator } from "../financial-profile/public.js";
import type { EvaluationRecommender } from "../recommendations/public.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockFn = jest.Mock<any>;

const ctx: TenantContext = {
  userId: "user-1",
  tenantId: "tenant-a",
  tenantSlug: "banco-a",
  membershipId: "membership-1",
  role: "ANALYST",
  userName: "Carlos Analista",
  tenantName: "Banco A",
  taxId: "1234567012",
  institutionType: "COMMERCIAL_BANK",
};

const readinessWith = (products: Array<{ selected: boolean; applicantScope: string }>) => ({
  ready: true,
  completed: 3,
  percentage: 100,
  steps: { institution: true, source: true, products: true },
  tenant: { name: "Banco A" },
  source: { enabled: true },
  products,
});

/**
 * S4-HF-06 (congelar reglas y productos) y S4-HF-07 (empresa solo con cobertura
 * real) sobre EvaluationsService. Son pruebas de reproducción: si fallan contra
 * el código original, el bug queda confirmado.
 */
describe("S4-HF-06 / S4-HF-07 — EvaluationsService", () => {
  let service: EvaluationsService;
  let insideUnitOfWork: boolean;
  let writesOutsideUnitOfWork: string[];
  let mockDb: {
    client: {
      evaluation: { findUnique: MockFn; findFirst: MockFn; create: MockFn; update: MockFn };
      evaluationSourceResult: { upsert: MockFn };
      integrationProvider: { findUnique: MockFn };
    };
    run: MockFn;
  };
  let mockClients: { findByDocument: MockFn; findOrCreate: MockFn };
  let mockPreparation: { read: MockFn };
  let mockAudit: { recordEvaluationDraft: MockFn; recordEvaluationProcessed: MockFn };
  let mockBank: { query: MockFn; status: MockFn; enable: MockFn };
  let mockBureau: { query: MockFn; status: MockFn; enable: MockFn };
  let mockProfileCalculator: { calculate: MockFn; consolidate: MockFn; saveProfile: MockFn };
  let mockRecommender: { evaluate: MockFn };

  beforeEach(() => {
    insideUnitOfWork = false;
    writesOutsideUnitOfWork = [];

    mockDb = {
      client: {
        evaluation: {
          findUnique: jest.fn<any>().mockResolvedValue(null),
          findFirst: jest.fn(),
          create: jest.fn<any>().mockImplementation(async ({ data }: any) => ({
            id: "eval-new",
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
            client: null,
            profile: null,
            sourceResults: [],
          })),
          update: jest.fn<any>().mockImplementation(async ({ data }: any) => ({
            id: "eval-1",
            tenantId: "tenant-a",
            clientId: "client-1",
            purpose: "WORKING_CAPITAL",
            requestedAmount: 60000,
            consentGivenAt: new Date(),
            applicantSnapshot: {},
            ruleVersion: "1.0.0",
            createdAt: new Date(),
            updatedAt: new Date(),
            client: null,
            profile: null,
            sourceResults: [],
            recommendations: [],
            ...data,
          })),
        },
        evaluationSourceResult: {
          upsert: jest.fn<any>().mockImplementation(async ({ create }: any) => ({ ...create })),
        },
        integrationProvider: {
          findUnique: jest.fn<any>().mockImplementation((args: any) => {
            if (args?.where?.code === "BANK_MOCK")
              return Promise.resolve({ id: "p-bank", code: "BANK_MOCK" });
            if (args?.where?.code === "BUREAU_MOCK")
              return Promise.resolve({ id: "p-bureau", code: "BUREAU_MOCK" });
            return Promise.resolve(null);
          }),
        },
      },
      run: jest.fn(async (work: () => Promise<unknown>) => {
        insideUnitOfWork = true;
        try {
          return await work();
        } finally {
          insideUnitOfWork = false;
        }
      }) as MockFn,
    };

    mockClients = {
      findByDocument: jest.fn(),
      findOrCreate: jest.fn<any>().mockResolvedValue({
        client: {
          id: "client-1",
          type: "COMPANY",
          documentType: "NIT",
          documentNumber: "1020304050",
          name: "Empresa Andina S.R.L.",
          economicActivity: "Comercio",
        },
        created: true,
      }),
    };
    mockPreparation = { read: jest.fn() };
    mockAudit = { recordEvaluationDraft: jest.fn(), recordEvaluationProcessed: jest.fn() };
    mockBank = {
      query: jest.fn<any>().mockResolvedValue({
        status: "SUCCESS",
        data: {
          documentNumber: "1020304050",
          accounts: [],
          loans: [],
          reportedAt: "2026-10-18",
          currency: "BOB",
        },
        externalReference: "BM-1020304050",
        providerId: "p-bank",
      }),
      status: jest.fn<any>().mockResolvedValue({ available: true, enabled: true, healthStatus: "ACTIVE" }),
      enable: jest.fn(),
    };
    mockBureau = {
      query: jest.fn<any>().mockResolvedValue({
        status: "SUCCESS",
        data: {
          documentNumber: "1020304050",
          totalSystemDebt: 1,
          activeCreditsCount: 0,
          worstDelinquencyDays: 0,
          hasRecentArrears: false,
          loans: [],
          reportedAt: "2026-10-18",
          currency: "BOB",
        },
        externalReference: "BUR-1020304050",
        providerId: "p-bureau",
      }),
      status: jest
        .fn<any>()
        .mockResolvedValue({ available: false, enabled: false, healthStatus: "INACTIVE" }),
      enable: jest.fn(),
    };
    mockProfileCalculator = {
      calculate: jest.fn(),
      consolidate: jest.fn<any>().mockReturnValue({
        indicators: { averageMonthlyIncome: 30000, completeness: 1, profileVersion: "1.0.0" },
        provenance: {},
      }),
      saveProfile: jest.fn<any>().mockImplementation(async () => {
        if (!insideUnitOfWork) writesOutsideUnitOfWork.push("saveProfile");
        return { id: "prof-1" };
      }),
    };
    mockRecommender = {
      evaluate: jest.fn<any>().mockImplementation(async () => {
        if (!insideUnitOfWork) writesOutsideUnitOfWork.push("recommender.evaluate");
        return [];
      }),
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

  const companyDraft = (overrides: Record<string, unknown> = {}) => ({
    id: "eval-1",
    tenantId: "tenant-a",
    clientId: "client-1",
    status: "DRAFT",
    purpose: "WORKING_CAPITAL",
    requestedAmount: 60000,
    consentGivenAt: new Date("2026-10-18T10:00:00Z"),
    startedAt: null,
    applicantSnapshot: { type: "COMPANY", documentType: "NIT", documentNumber: "1020304050" },
    client: {
      id: "client-1",
      type: "COMPANY",
      documentType: "NIT",
      documentNumber: "1020304050",
      name: "Empresa Andina S.R.L.",
    },
    sourceResults: [],
    recommendations: [],
    ...overrides,
  });

  const historicalEvaluation = (recommendation: Record<string, unknown>) => ({
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
    profile: null,
    sourceResults: [],
    recommendations: [recommendation],
  });

  describe("S4-HF-06 — resultado histórico coherente tras editar el catálogo", () => {
    it("HF-06/3: el historial muestra el producto congelado, no el producto vivo editado después", async () => {
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce(
        historicalEvaluation({
          id: "rec-1",
          productId: "prod-1",
          outcome: "NOT_COMPATIBLE",
          ruleVersion: "1.0.0",
          evaluatedAt: new Date("2026-10-01T10:05:00Z"),
          productSnapshot: {
            name: "Pyme Productivo",
            category: "SME_CREDIT",
            applicantScope: "COMPANY",
            minAmount: 10000,
            maxAmount: 20000,
          },
          // El admin editó el catálogo después de evaluar:
          product: { name: "Producto Renombrado", category: "MICRO_CREDIT", minAmount: "1", maxAmount: "2" },
          reasons: [
            {
              code: "RULE_AMOUNT_RANGE",
              message:
                "El monto solicitado supera el límite máximo permitido para este producto (máximo: Bs. 20.000).",
              passed: false,
            },
          ],
        }),
      );

      const res = await service.getById(ctx, "eval-hist-1");

      expect(res.recommendations[0].productName).toBe("Pyme Productivo");
      expect(res.recommendations[0].category).toBe("SME_CREDIT");
      expect(res.recommendations[0].minAmount).toBe(10000);
      expect(res.recommendations[0].maxAmount).toBe(20000);
    });

    it("HF-06/4: las filas anteriores al hotfix, sin snapshot, siguen usando el producto vinculado", async () => {
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce(
        historicalEvaluation({
          id: "rec-legacy",
          productId: "prod-1",
          outcome: "RECOMMENDED",
          ruleVersion: "1.0.0",
          evaluatedAt: new Date("2026-10-01T10:05:00Z"),
          productSnapshot: null,
          product: {
            name: "Pyme Productivo",
            category: "SME_CREDIT",
            minAmount: "10000",
            maxAmount: "100000",
          },
          reasons: [],
        }),
      );

      const res = await service.getById(ctx, "eval-hist-1");

      expect(res.recommendations[0].productName).toBe("Pyme Productivo");
      expect(res.recommendations[0].maxAmount).toBe(100000);
    });

    it("HF-06/5: perfil, recomendaciones y cierre de la evaluación ocurren en una sola unidad de trabajo", async () => {
      mockPreparation.read.mockResolvedValue(readinessWith([{ selected: true, applicantScope: "COMPANY" }]));
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce(companyDraft());

      await service.processEvaluation(ctx, "eval-1");

      expect(mockDb.run).toHaveBeenCalledTimes(1);
      expect(mockRecommender.evaluate).toHaveBeenCalledTimes(1);
      expect(writesOutsideUnitOfWork).toEqual([]);
    });
  });

  describe("S4-HF-07 — empresa solo con cobertura real", () => {
    it("HF-07/4: una empresa no consulta el Buró (solo cubre personas) aunque esté habilitado", async () => {
      mockPreparation.read.mockResolvedValue(readinessWith([{ selected: true, applicantScope: "COMPANY" }]));
      mockBureau.status.mockResolvedValue({ available: true, enabled: true, healthStatus: "ACTIVE" });
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce(companyDraft());

      await service.processEvaluation(ctx, "eval-1");

      expect(mockBank.query).toHaveBeenCalledWith("tenant-a", "1020304050", "COMPANY");
      expect(mockBureau.query).not.toHaveBeenCalled();
      expect(mockRecommender.evaluate).toHaveBeenCalledWith(
        "tenant-a",
        "eval-1",
        expect.objectContaining({ applicantScope: "COMPANY" }),
      );
    });

    it("HF-07/5: una persona sí consulta Banco y Buró cuando el Buró está habilitado", async () => {
      mockPreparation.read.mockResolvedValue(readinessWith([{ selected: true, applicantScope: "PERSON" }]));
      mockBureau.status.mockResolvedValue({ available: true, enabled: true, healthStatus: "ACTIVE" });
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce(
        companyDraft({
          applicantSnapshot: { type: "PERSON", documentType: "CI", documentNumber: "4892019" },
          client: {
            id: "client-2",
            type: "PERSON",
            documentType: "CI",
            documentNumber: "4892019",
            name: "Juan Pérez",
          },
        }),
      );

      await service.processEvaluation(ctx, "eval-1");

      expect(mockBank.query).toHaveBeenCalledWith("tenant-a", "4892019", "PERSON");
      expect(mockBureau.query).toHaveBeenCalledWith("tenant-a", "4892019");
    });

    it("HF-07/6: createDraft rechaza una empresa cuyo documento no es NIT antes de crear cliente o evaluación", async () => {
      mockPreparation.read.mockResolvedValue(readinessWith([{ selected: true, applicantScope: "COMPANY" }]));

      await expect(
        service.createDraft(ctx, {
          clientType: ClientTypeDto.COMPANY,
          documentType: DocumentTypeDto.CI,
          documentNumber: "4892019",
          name: "Empresa con CI S.R.L.",
          purpose: CreditPurposeDto.WORKING_CAPITAL,
          requestedAmount: 50000,
          consentGiven: true,
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockClients.findOrCreate).not.toHaveBeenCalled();
      expect(mockDb.client.evaluation.create).not.toHaveBeenCalled();
    });

    it("HF-07/7: createDraft sigue aceptando una empresa con NIT", async () => {
      mockPreparation.read.mockResolvedValue(readinessWith([{ selected: true, applicantScope: "COMPANY" }]));

      const res = await service.createDraft(ctx, {
        clientType: ClientTypeDto.COMPANY,
        documentType: DocumentTypeDto.NIT,
        documentNumber: "1020304050",
        name: "Empresa Andina S.R.L.",
        economicActivity: "Comercio",
        purpose: CreditPurposeDto.WORKING_CAPITAL,
        requestedAmount: 50000,
        consentGiven: true,
      });

      expect(res.status).toBe("DRAFT");
      expect(mockClients.findOrCreate).toHaveBeenCalledTimes(1);
    });

    it("HF-07/8: processEvaluation revalida la elegibilidad antes de cambiar estado o consultar fuentes", async () => {
      // El borrador se creó cuando había producto empresarial; hoy ya no existe ninguno seleccionado.
      mockPreparation.read.mockResolvedValue(readinessWith([{ selected: true, applicantScope: "PERSON" }]));
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce(companyDraft());

      await expect(service.processEvaluation(ctx, "eval-1")).rejects.toThrow(BadRequestException);

      expect(mockDb.client.evaluation.update).not.toHaveBeenCalled();
      expect(mockBank.query).not.toHaveBeenCalled();
      expect(mockBureau.query).not.toHaveBeenCalled();
    });

    it("HF-07/9: processEvaluation rechaza una empresa registrada con un documento que no es NIT", async () => {
      mockPreparation.read.mockResolvedValue(readinessWith([{ selected: true, applicantScope: "COMPANY" }]));
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce(
        companyDraft({
          client: {
            id: "client-1",
            type: "COMPANY",
            documentType: "CI",
            documentNumber: "4892019",
            name: "Empresa",
          },
        }),
      );

      await expect(service.processEvaluation(ctx, "eval-1")).rejects.toThrow(BadRequestException);

      expect(mockDb.client.evaluation.update).not.toHaveBeenCalled();
      expect(mockBank.query).not.toHaveBeenCalled();
    });

    it("HF-07/10: el motivo de readiness explica que el Buró habilitado no cubre empresas", async () => {
      mockPreparation.read.mockResolvedValue({
        ...readinessWith([{ selected: true, applicantScope: "COMPANY" }]),
        source: { enabled: false },
      });
      mockBureau.status.mockResolvedValue({ available: true, enabled: true, healthStatus: "ACTIVE" });

      const res = await service.checkReadiness(ctx);

      expect(res.supportedApplicantTypes.COMPANY.supported).toBe(false);
      expect(res.supportedApplicantTypes.COMPANY.reason).toMatch(/solo cubre(n)? personas/i);
    });
  });
});
