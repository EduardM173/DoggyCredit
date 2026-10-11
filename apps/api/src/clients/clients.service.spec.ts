import { jest } from "@jest/globals";
import { NotFoundException } from "@nestjs/common";
import { ClientsService } from "./clients.service.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import type { TenantContext } from "../identity-tenants/public.js";

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

describe("ClientsService (HU-14)", () => {
  let service: ClientsService;
  let mockDb: {
    client: {
      client: {
        findUnique: MockFn;
        findFirst: MockFn;
        create: MockFn;
      };
      evaluation: {
        findMany: MockFn;
      };
    };
  };

  beforeEach(() => {
    mockDb = {
      client: {
        client: {
          findUnique: jest.fn(),
          findFirst: jest.fn(),
          create: jest.fn(),
        },
        evaluation: {
          findMany: jest.fn(),
        },
      },
    };
    service = new ClientsService(mockDb as unknown as DatabaseUnitOfWork);
  });

  describe("findByDocument()", () => {
    it("finds client by tenant, documentType and documentNumber", async () => {
      mockDb.client.client.findUnique.mockResolvedValueOnce({
        id: "c-1",
        tenantId: "tenant-a",
        type: "COMPANY",
        documentType: "NIT",
        documentNumber: "1234567890",
        name: "Acme Corp",
      });

      const result = await service.findByDocument(
        "tenant-a",
        "NIT",
        " 1234567890 ",
        "COMPANY",
      );

      expect(mockDb.client.client.findUnique).toHaveBeenCalledWith({
        where: {
          tenantId_documentType_documentNumber: {
            tenantId: "tenant-a",
            documentType: "NIT",
            documentNumber: "1234567890",
          },
        },
      });
      expect(result).not.toBeNull();
      expect(result?.name).toBe("Acme Corp");
    });

    it("returns null if found client type does not match requested type", async () => {
      mockDb.client.client.findUnique.mockResolvedValueOnce({
        id: "c-1",
        tenantId: "tenant-a",
        type: "PERSON",
        documentType: "CI",
        documentNumber: "1234567",
        name: "Juan Perez",
      });

      const result = await service.findByDocument(
        "tenant-a",
        "CI",
        "1234567",
        "COMPANY",
      );

      expect(result).toBeNull();
    });
  });

  describe("findOrCreate()", () => {
    it("returns existing client if already exists with matching type", async () => {
      mockDb.client.client.findUnique.mockResolvedValueOnce({
        id: "c-1",
        tenantId: "tenant-a",
        type: "COMPANY",
        documentType: "NIT",
        documentNumber: "1020304050",
        name: "Empresa S.A.",
      });

      const result = await service.findOrCreate("tenant-a", {
        type: "COMPANY",
        documentType: "NIT",
        documentNumber: "1020304050",
        name: "Empresa S.A.",
      });

      expect(result.created).toBe(false);
      expect(result.client.id).toBe("c-1");
      expect(mockDb.client.client.create).not.toHaveBeenCalled();
    });

    it("creates new company client with economicActivity", async () => {
      mockDb.client.client.findUnique.mockResolvedValueOnce(null);
      mockDb.client.client.create.mockResolvedValueOnce({
        id: "c-2",
        tenantId: "tenant-a",
        type: "COMPANY",
        documentType: "NIT",
        documentNumber: "9876543210",
        name: "Distribuidora Los Andes S.R.L.",
        economicActivity: "Venta al por mayor",
      });

      const result = await service.findOrCreate("tenant-a", {
        type: "COMPANY",
        documentType: "NIT",
        documentNumber: "9876543210",
        name: "Distribuidora Los Andes S.R.L.",
        economicActivity: "Venta al por mayor",
      });

      expect(result.created).toBe(true);
      expect(mockDb.client.client.create).toHaveBeenCalledWith({
        data: {
          tenantId: "tenant-a",
          type: "COMPANY",
          documentType: "NIT",
          documentNumber: "9876543210",
          name: "Distribuidora Los Andes S.R.L.",
          email: null,
          phone: null,
          address: null,
          economicActivity: "Venta al por mayor",
        },
      });
      expect(result.client.economicActivity).toBe("Venta al por mayor");
    });
  });

  describe("HU-19 Consultar el expediente y las evaluaciones de un solicitante", () => {
    it("PA-19.01 & CA-19.01 & CA-19.05: returns applicant dossier and linked evaluations with original data", async () => {
      mockDb.client.client.findFirst.mockResolvedValueOnce({
        id: "c-100",
        tenantId: "tenant-a",
        type: "PERSON",
        documentType: "CI",
        documentNumber: "1234567",
        name: "Carlos Sanchez",
        email: "carlos@example.com",
        phone: "+591 71234567",
        address: "Av. Heroinas 456",
        economicActivity: null,
        createdAt: new Date("2026-08-01T10:00:00.000Z"),
        updatedAt: new Date("2026-08-01T10:00:00.000Z"),
      });

      mockDb.client.evaluation.findMany.mockResolvedValueOnce([
        {
          id: "eval-1",
          tenantId: "tenant-a",
          clientId: "c-100",
          purpose: "WORKING_CAPITAL",
          requestedAmount: 15000,
          status: "COMPLETED",
          createdAt: new Date("2026-09-01T12:00:00.000Z"),
          completedAt: new Date("2026-09-01T12:05:00.000Z"),
          ruleVersion: "1.0.0",
          applicantSnapshot: { name: "Carlos Sanchez" },
          recommendations: [
            { id: "r-1", outcome: "RECOMMENDED" },
          ],
          profile: {
            id: "prof-1",
            averageMonthlyIncome: 5000,
            averageMonthlyExpenses: 2000,
            disposableIncome: 3000,
            totalDebt: 1000,
            activeCredits: 1,
            debtToIncome: 0.05,
            hasRecentArrears: false,
            completeness: 1,
            calculatedAt: new Date("2026-09-01T12:05:00.000Z"),
          },
        },
      ]);

      const dossier = await service.getDossier(makeContext({ tenantId: "tenant-a" }), "c-100");

      expect(dossier.client.id).toBe("c-100");
      expect(dossier.client.name).toBe("Carlos Sanchez");
      expect(dossier.client.documentNumber).toBe("1234567");
      expect(dossier.evaluations).toHaveLength(1);
      expect(dossier.evaluations[0].id).toBe("eval-1");
      expect(dossier.evaluations[0].status).toBe("COMPLETED");
      expect(dossier.evaluations[0].compatibleProductsCount).toBe(1);
      expect(dossier.latestFinancialProfile).not.toBeNull();
      expect(dossier.latestFinancialProfile?.disposableIncome).toBe(3000);
    });

    it("PA-19.02 & PA-19.03 & CA-19.02 & CA-19.04: declared data is kept separate from historical snapshots and financial data is read-only", async () => {
      mockDb.client.client.findFirst.mockResolvedValueOnce({
        id: "c-200",
        tenantId: "tenant-a",
        type: "COMPANY",
        documentType: "NIT",
        documentNumber: "88888888",
        name: "Empresa Renombrada SRL",
        email: "contacto@renombrada.com",
        phone: "4444444",
        address: "Calle Comercio 100",
        economicActivity: "Construcción",
        createdAt: new Date("2026-07-01T08:00:00.000Z"),
        updatedAt: new Date("2026-10-01T08:00:00.000Z"),
      });

      mockDb.client.evaluation.findMany.mockResolvedValueOnce([
        {
          id: "eval-old",
          tenantId: "tenant-a",
          clientId: "c-200",
          purpose: "BUSINESS_INVESTMENT",
          requestedAmount: 100000,
          status: "COMPLETED",
          createdAt: new Date("2026-07-15T10:00:00.000Z"),
          completedAt: new Date("2026-07-15T10:05:00.000Z"),
          ruleVersion: "1.0.0",
          applicantSnapshot: { name: "Empresa Original SRL", documentNumber: "88888888" },
          recommendations: [],
          profile: null,
        },
      ]);

      const dossier = await service.getDossier(makeContext({ tenantId: "tenant-a" }), "c-200");

      // Declared data has current name
      expect(dossier.client.name).toBe("Empresa Renombrada SRL");
      // Historical evaluation retains original snapshot name (PA-19.02)
      expect(
        (dossier.evaluations[0].applicantSnapshot as { name: string }).name,
      ).toBe("Empresa Original SRL");
      // Zero DB mutations occurred during dossier consultation
      expect(mockDb.client.client.create).not.toHaveBeenCalled();
    });

    it("PA-19.04 & CA-19.08: prevents reading dossier of another tenant even if requested by ID or matching document", async () => {
      // Carlos belongs to tenant-a, client exists only in tenant-b
      mockDb.client.client.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.getDossier(makeContext({ tenantId: "tenant-a" }), "client-of-tenant-b"),
      ).rejects.toThrow(NotFoundException);

      expect(mockDb.client.client.findFirst).toHaveBeenCalledWith({
        where: {
          id: "client-of-tenant-b",
          tenantId: "tenant-a",
        },
      });
    });
  });
});
