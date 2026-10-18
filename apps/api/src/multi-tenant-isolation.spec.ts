import { jest } from "@jest/globals";
import { NotFoundException } from "@nestjs/common";
import { ClientsService } from "./clients/public.js";
import { EvaluationsService } from "./evaluations/public.js";
import { ProductsCatalogService } from "./recommendations/public.js";
import { BureauMockSourceService } from "./financial-integrations/public.js";
import type { DatabaseUnitOfWork } from "./infrastructure/prisma/database-unit-of-work.js";
import type { TenantContext } from "./identity-tenants/public.js";
import type { AuditWriter } from "./audit/public.js";
import type { ResilientSources } from "./financial-integrations/resilience/resilient-sources.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockFn = jest.Mock<any>;

const makeContext = (
  tenantId: string,
  role: "INSTITUTION_ADMIN" | "ANALYST" = "ANALYST",
): TenantContext => ({
  userId: `user-${tenantId}`,
  tenantId,
  tenantSlug: tenantId,
  membershipId: `mem-${tenantId}`,
  role,
  userName: `User of ${tenantId}`,
  tenantName: `Institution ${tenantId}`,
  taxId: "90001000",
  institutionType: "COMMERCIAL_BANK",
});

describe("Multi-Tenant Isolation Verification — Sprint 3 Full Lifecycle", () => {
  let mockDb: {
    client: {
      integrationProvider: { findUnique: MockFn };
      tenantIntegration: { findUnique: MockFn; upsert: MockFn };
      client: { findUnique: MockFn; findFirst: MockFn; create: MockFn };
      financialProduct: { findMany: MockFn; findFirst: MockFn; create: MockFn };
      financialProductPurpose: { createMany: MockFn };
      evaluation: { findFirst: MockFn; findMany: MockFn; count: MockFn; create: MockFn; update: MockFn };
      evaluationSourceResult: { upsert: MockFn };
    };
    run: MockFn;
  };
  let mockAudit: {
    recordProductCatalogAction: MockFn;
    recordEvaluationDraft: MockFn;
    recordEvaluationProcessed: MockFn;
  };

  // Services
  let bureauService: BureauMockSourceService;
  let clientsService: ClientsService;
  let catalogService: ProductsCatalogService;
  let evaluationsService: EvaluationsService;

  const solCtx = makeContext("tenant-sol", "INSTITUTION_ADMIN");
  const fieCtx = makeContext("tenant-fie", "INSTITUTION_ADMIN");

  beforeEach(() => {
    mockDb = {
      client: {
        integrationProvider: {
          findUnique: jest.fn<any>().mockImplementation((args: any) => {
            if (args?.where?.code === "BUREAU_MOCK") {
              return Promise.resolve({ id: "prov-bureau", code: "BUREAU_MOCK", status: "ACTIVE" });
            }
            if (args?.where?.code === "BANK_MOCK") {
              return Promise.resolve({ id: "prov-bank", code: "BANK_MOCK", status: "ACTIVE" });
            }
            return Promise.resolve(null);
          }),
        },
        tenantIntegration: {
          findUnique: jest.fn<any>(),
          upsert: jest.fn<any>(),
        },
        client: {
          findUnique: jest.fn<any>(),
          findFirst: jest.fn<any>(),
          create: jest.fn<any>(),
        },
        financialProduct: {
          findMany: jest.fn<any>(),
          findFirst: jest.fn<any>(),
          create: jest.fn<any>(),
        },
        financialProductPurpose: {
          createMany: jest.fn<any>(),
        },
        evaluation: {
          findFirst: jest.fn<any>(),
          findMany: jest.fn<any>(),
          count: jest.fn<any>(),
          create: jest.fn<any>(),
          update: jest.fn<any>(),
        },
        evaluationSourceResult: {
          upsert: jest.fn<any>(),
        },
      },
      run: jest.fn<any>().mockImplementation((cb: any) => cb(mockDb)),
    };

    mockAudit = {
      recordProductCatalogAction: jest.fn<any>(),
      recordEvaluationDraft: jest.fn<any>(),
      recordEvaluationProcessed: jest.fn<any>(),
    };

    bureauService = new BureauMockSourceService(mockDb as unknown as DatabaseUnitOfWork);
    clientsService = new ClientsService(mockDb as unknown as DatabaseUnitOfWork);
    catalogService = new ProductsCatalogService(
      mockDb as unknown as DatabaseUnitOfWork,
      mockAudit as unknown as AuditWriter,
    );

    const mockPreparation: any = {
      read: jest.fn<any>().mockResolvedValue({
        ready: true,
        source: { enabled: true },
        steps: { source: true, products: true },
        products: [{ selected: true, applicantScope: "BOTH" }],
      }),
    };
    const mockBankSource: any = {
      query: jest.fn<any>().mockResolvedValue({ status: "SUCCESS", data: { accounts: [] }, providerId: "prov-bank" }),
      status: jest.fn<any>().mockResolvedValue({ available: true, enabled: true }),
    };
    const mockProfileCalc: any = {
      calculate: jest.fn<any>(),
      consolidate: jest.fn<any>().mockReturnValue({
        averageMonthlyIncome: 10000,
        averageMonthlyExpenses: 4000,
        disposableIncome: 6000,
        totalDebt: 2000,
        activeCredits: 1,
        debtToIncome: 0.2,
        hasRecentArrears: false,
        completeness: 1,
        profileVersion: "1.0.0",
        indicatorProvenance: {},
      }),
      saveProfile: jest.fn<any>().mockResolvedValue({ id: "prof-1" }),
    };
    const mockRecommender: any = {
      evaluate: jest.fn<any>().mockResolvedValue([]),
    };

    evaluationsService = new EvaluationsService(
      mockDb as unknown as DatabaseUnitOfWork,
      clientsService,
      mockPreparation,
      mockAudit as unknown as AuditWriter,
      mockBankSource,
      bureauService,
      mockProfileCalc,
      mockRecommender,
      {
        queryBank: (_providerId: string | undefined, ...args: unknown[]) =>
          (mockBankSource.query as (...a: unknown[]) => unknown)(...args),
        queryBureau: (_providerId: string | undefined, ...args: unknown[]) =>
          (bureauService.query as unknown as (...a: unknown[]) => unknown).apply(bureauService, args),
      } as unknown as ResilientSources,
    );
  });

  describe("1. HU-13: Aislamiento en habilitación de fuentes (Buró Mock)", () => {
    it("habilitar Buró Mock en Banco Sol NO afecta ni habilita a Banco Fie", async () => {
      // 1. Sol enables Bureau Mock
      mockDb.client.tenantIntegration.findUnique.mockResolvedValueOnce(null); // Sol not yet enabled
      await bureauService.enable(solCtx.tenantId, true);

      expect(mockDb.client.tenantIntegration.upsert).toHaveBeenCalledWith({
        where: { tenantId_providerId: { tenantId: "tenant-sol", providerId: "prov-bureau" } },
        update: { enabled: true, status: "ACTIVE", lastErrorCode: null },
        create: { tenantId: "tenant-sol", providerId: "prov-bureau", enabled: true, status: "ACTIVE" },
      });

      // 2. Query Fie status
      mockDb.client.tenantIntegration.findUnique.mockResolvedValueOnce(null); // Fie has no record
      const fieStatus = await bureauService.status("tenant-fie");

      expect(fieStatus.available).toBe(true);
      expect(fieStatus.enabled).toBe(false);
      expect(mockDb.client.tenantIntegration.findUnique).toHaveBeenCalledWith({
        where: { tenantId_providerId: { tenantId: "tenant-fie", providerId: "prov-bureau" } },
        select: { enabled: true, status: true },
      });
    });
  });

  describe("2. HU-14: Aislamiento en expedientes y clientes de empresa", () => {
    it("empresa registrada con NIT en Banco Sol es invisible para Banco Fie", async () => {
      // Sol searches by NIT -> finds Empresa Sol
      mockDb.client.client.findUnique.mockResolvedValueOnce({
        id: "client-sol-1",
        tenantId: "tenant-sol",
        type: "COMPANY",
        documentType: "NIT",
        documentNumber: "1020304050",
        name: "Constructora Sol SRL",
      });

      const solClient = await clientsService.findByDocument(
        solCtx.tenantId,
        "NIT",
        "1020304050",
        "COMPANY",
      );
      expect(solClient?.id).toBe("client-sol-1");
      expect(solClient?.name).toBe("Constructora Sol SRL");

      // Fie searches same NIT -> findUnique is scoped to tenant-fie -> returns null
      mockDb.client.client.findUnique.mockResolvedValueOnce(null);

      const fieClient = await clientsService.findByDocument(
        "tenant-fie",
        "NIT",
        "1020304050",
        "COMPANY",
      );
      expect(fieClient).toBeNull();
      expect(mockDb.client.client.findUnique).toHaveBeenLastCalledWith({
        where: {
          tenantId_documentType_documentNumber: {
            tenantId: "tenant-fie",
            documentType: "NIT",
            documentNumber: "1020304050",
          },
        },
      });
    });
  });

  describe("3. HU-16: Aislamiento en catálogo de productos institucionales", () => {
    it("productos creados por Banco Sol no son visibles ni modificables por Banco Fie", async () => {
      // Fie lists products -> returns only Fie products
      mockDb.client.financialProduct.findMany.mockResolvedValueOnce([
        {
          id: "prod-fie-1",
          tenantId: "tenant-fie",
          name: "Crédito Productivo Fie",
          category: "SME_CREDIT",
          applicantScope: "COMPANY",
          minAmount: 5000,
          maxAmount: 100000,
          active: true,
          purposes: [{ purpose: "WORKING_CAPITAL" }],
        },
      ]);

      const fieProducts = await catalogService.list(fieCtx);
      expect(fieProducts).toHaveLength(1);
      expect(fieProducts[0].name).toBe("Crédito Productivo Fie");
      expect(mockDb.client.financialProduct.findMany).toHaveBeenCalledWith({
        where: { tenantId: "tenant-fie" },
        include: { purposes: { select: { purpose: true } } },
        orderBy: [{ active: "desc" }, { name: "asc" }],
      });

      // Fie attempts to getById a Sol product -> throws NotFoundException
      mockDb.client.financialProduct.findFirst.mockResolvedValueOnce(null);

      await expect(
        catalogService.getById(fieCtx, "prod-sol-secret-id"),
      ).rejects.toThrow(NotFoundException);

      expect(mockDb.client.financialProduct.findFirst).toHaveBeenCalledWith({
        where: { id: "prod-sol-secret-id", tenantId: "tenant-fie" },
        include: { purposes: { select: { purpose: true } } },
      });
    });
  });

  describe("4. HU-18: Aislamiento en historial y recuperación de evaluaciones", () => {
    it("Banco Fie no puede listar ni ver detalle de evaluaciones de Banco Sol", async () => {
      // 1. Listing evaluations for Fie -> filters strictly where: { tenantId: 'tenant-fie' }
      mockDb.client.evaluation.count.mockResolvedValueOnce(0);
      mockDb.client.evaluation.findMany.mockResolvedValueOnce([]);

      const fieList = await evaluationsService.list(fieCtx, { page: 1, limit: 10 });
      expect(fieList.total).toBe(0);
      expect(fieList.items).toHaveLength(0);
      expect(mockDb.client.evaluation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenantId: "tenant-fie" },
        }),
      );

      // 2. Direct getById on an evaluation belonging to Sol from Fie context -> 404
      mockDb.client.evaluation.findFirst.mockResolvedValueOnce(null);

      await expect(
        evaluationsService.getById(fieCtx, "eval-sol-123"),
      ).rejects.toThrow(NotFoundException);

      expect(mockDb.client.evaluation.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "eval-sol-123", tenantId: "tenant-fie" },
        }),
      );
    });
  });

  describe("5. HU-19: Aislamiento en expediente del solicitante (Dossier)", () => {
    it("Banco Fie recibe 404 Not Found al intentar consultar expediente de un cliente de Banco Sol", async () => {
      mockDb.client.client.findFirst.mockResolvedValueOnce(null);

      await expect(
        clientsService.getDossier(fieCtx, "client-sol-uuid"),
      ).rejects.toThrow(NotFoundException);

      expect(mockDb.client.client.findFirst).toHaveBeenCalledWith({
        where: {
          id: "client-sol-uuid",
          tenantId: "tenant-fie",
        },
      });
    });
  });
});
