import { jest } from "@jest/globals";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { ProductsCatalogService } from "./products-catalog.service.js";
import type { TenantContext } from "../identity-tenants/public.js";
import { ApplicantScope, CreditPurpose, ProductCategory } from "../generated/prisma/enums.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockFn = jest.Mock<any>;

describe("ProductsCatalogService (HU-16)", () => {
  let service: ProductsCatalogService;
  let mockDb: {
    client: {
      financialProduct: {
        findMany: MockFn;
        findFirst: MockFn;
        create: MockFn;
        update: MockFn;
      };
      financialProductPurpose: {
        createMany: MockFn;
        deleteMany: MockFn;
      };
    };
    run: MockFn;
  };
  let mockAudit: {
    recordProductCatalogAction: MockFn;
  };

  const makeContext = (overrides?: Partial<TenantContext>): TenantContext => ({
    tenantId: "tenant-bank-x",
    tenantSlug: "banco-x",
    tenantName: "Banco X S.A.",
    taxId: "1234567012",
    institutionType: "COMMERCIAL_BANK",
    userId: "user-ana",
    userName: "Ana Admin",
    membershipId: "mem-ana",
    role: "INSTITUTION_ADMIN",
    ...overrides,
  });

  beforeEach(() => {
    mockDb = {
      client: {
        financialProduct: {
          findMany: jest.fn(),
          findFirst: jest.fn(),
          create: jest.fn(),
          update: jest.fn(),
        },
        financialProductPurpose: {
          createMany: jest.fn(),
          deleteMany: jest.fn(),
        },
      },
      run: jest.fn(async (cb: () => Promise<unknown>) => cb()),
    };

    mockAudit = {
      recordProductCatalogAction: jest.fn<any>().mockResolvedValue(undefined),
    };

    service = new ProductsCatalogService(mockDb as any, mockAudit as any);
  });

  describe("PA-16.01 — Crear un producto para Banco X", () => {
    it("allows Ana (admin) to create a product with valid fields and purposes", async () => {
      mockDb.client.financialProduct.findFirst
        .mockResolvedValueOnce(null) // no duplicate
        .mockResolvedValueOnce({
          id: "prod-new-1",
          tenantId: "tenant-bank-x",
          name: "Microcrédito Productivo",
          category: ProductCategory.MICRO_CREDIT,
          applicantScope: ApplicantScope.PERSON,
          minAmount: 1000,
          maxAmount: 50000,
          maxDebtToIncome: 0.4,
          minMonthlyDisposableIncome: 2000,
          allowsRecentArrears: false,
          active: true,
          purposes: [{ purpose: CreditPurpose.WORKING_CAPITAL }],
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      mockDb.client.financialProduct.create.mockResolvedValueOnce({
        id: "prod-new-1",
        tenantId: "tenant-bank-x",
        name: "Microcrédito Productivo",
      });

      const res = await service.create(makeContext(), {
        name: "Microcrédito Productivo",
        category: ProductCategory.MICRO_CREDIT,
        applicantScope: ApplicantScope.PERSON,
        minAmount: 1000,
        maxAmount: 50000,
        maxDebtToIncome: 0.4,
        minMonthlyDisposableIncome: 2000,
        allowsRecentArrears: false,
        purposes: [CreditPurpose.WORKING_CAPITAL],
      });

      expect(res.id).toBe("prod-new-1");
      expect(res.name).toBe("Microcrédito Productivo");
      expect(res.active).toBe(true);
      expect(mockDb.client.financialProduct.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: "tenant-bank-x",
            name: "Microcrédito Productivo",
            minAmount: 1000,
            maxAmount: 50000,
          }),
        }),
      );
      expect(mockAudit.recordProductCatalogAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "PRODUCT_CREATED",
          tenantId: "tenant-bank-x",
          productId: "prod-new-1",
        }),
      );
    });
  });

  describe("PA-16.02 — Impedir rango incoherente y datos inválidos", () => {
    it("rejects maximum amount lower than minimum amount", async () => {
      mockDb.client.financialProduct.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.create(makeContext(), {
          name: "Crédito Rango Malo",
          category: ProductCategory.MICRO_CREDIT,
          applicantScope: ApplicantScope.PERSON,
          minAmount: 10000,
          maxAmount: 5000, // max < min!
          purposes: [CreditPurpose.WORKING_CAPITAL],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects zero or negative minimum amount", async () => {
      mockDb.client.financialProduct.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.create(makeContext(), {
          name: "Crédito Monto Cero",
          category: ProductCategory.MICRO_CREDIT,
          applicantScope: ApplicantScope.PERSON,
          minAmount: 0,
          maxAmount: 10000,
          purposes: [CreditPurpose.WORKING_CAPITAL],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects duplicate product name in the same tenant", async () => {
      mockDb.client.financialProduct.findFirst.mockResolvedValueOnce({
        id: "prod-existing",
        name: "Microcrédito Existente",
      });

      await expect(
        service.create(makeContext(), {
          name: "Microcrédito Existente",
          category: ProductCategory.MICRO_CREDIT,
          applicantScope: ApplicantScope.PERSON,
          minAmount: 1000,
          maxAmount: 10000,
          purposes: [CreditPurpose.WORKING_CAPITAL],
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("PA-16.03 — Desactivar sin cambiar el pasado", () => {
    it("deactivates product for future evaluations without deleting or modifying past evaluation rows", async () => {
      const existingProduct = {
        id: "prod-1",
        tenantId: "tenant-bank-x",
        name: "Crédito Comercial Histórico",
        applicantScope: ApplicantScope.PERSON,
        active: true,
        minAmount: 1000,
        maxAmount: 20000,
      };

      mockDb.client.financialProduct.findFirst
        .mockResolvedValueOnce(existingProduct) // for toggleStatus check
        .mockResolvedValueOnce(existingProduct) // for checkDeactivationImpact
        .mockResolvedValueOnce({ ...existingProduct, active: false, purposes: [] }); // for getById

      // There is another active product for PERSON, so it's not the last
      mockDb.client.financialProduct.findMany.mockResolvedValueOnce([
        { id: "prod-1", applicantScope: ApplicantScope.PERSON, active: true },
        { id: "prod-2", applicantScope: ApplicantScope.PERSON, active: true },
      ]);

      mockDb.client.financialProduct.update.mockResolvedValueOnce({
        ...existingProduct,
        active: false,
      });

      const res = await service.toggleStatus(makeContext(), "prod-1", false);

      expect(res.active).toBe(false);
      expect(mockDb.client.financialProduct.update).toHaveBeenCalledWith({
        where: { id: "prod-1" },
        data: { active: false },
      });
      expect(mockAudit.recordProductCatalogAction).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "PRODUCT_DEACTIVATED",
          productId: "prod-1",
        }),
      );
    });
  });

  describe("PA-16.04 — Desactivar último producto y orientar al analista", () => {
    it("warns with 409 Conflict if deactivating the last applicable product for Empresa without confirmation", async () => {
      const companyProduct = {
        id: "prod-empresa-1",
        tenantId: "tenant-bank-x",
        name: "Línea Pyme Capital",
        applicantScope: ApplicantScope.COMPANY,
        active: true,
      };

      mockDb.client.financialProduct.findFirst
        .mockResolvedValueOnce(companyProduct)
        .mockResolvedValueOnce(companyProduct);

      // Only this one company product active
      mockDb.client.financialProduct.findMany.mockResolvedValueOnce([companyProduct]);

      await expect(
        service.toggleStatus(makeContext(), "prod-empresa-1", false, false),
      ).rejects.toThrow(ConflictException);
    });

    it("allows deactivating the last product if confirmImpact is true", async () => {
      const companyProduct = {
        id: "prod-empresa-1",
        tenantId: "tenant-bank-x",
        name: "Línea Pyme Capital",
        applicantScope: ApplicantScope.COMPANY,
        active: true,
      };

      mockDb.client.financialProduct.findFirst
        .mockResolvedValueOnce(companyProduct)
        .mockResolvedValueOnce(companyProduct)
        .mockResolvedValueOnce({ ...companyProduct, active: false, purposes: [] });

      mockDb.client.financialProduct.findMany.mockResolvedValueOnce([companyProduct]);
      mockDb.client.financialProduct.update.mockResolvedValueOnce({
        ...companyProduct,
        active: false,
      });

      const res = await service.toggleStatus(makeContext(), "prod-empresa-1", false, true);

      expect(res.active).toBe(false);
      expect(mockDb.client.financialProduct.update).toHaveBeenCalledWith({
        where: { id: "prod-empresa-1" },
        data: { active: false },
      });
    });
  });

  describe("PA-16.05 — Restricción de permisos", () => {
    it("rejects credit analyst Carlos from creating a product with 403 Forbidden", async () => {
      const analystCtx = makeContext({
        role: "ANALYST",
        userId: "user-carlos",
        userName: "Carlos Analista",
      });

      await expect(
        service.create(analystCtx, {
          name: "Producto Hack",
          category: ProductCategory.OTHER,
          applicantScope: ApplicantScope.PERSON,
          minAmount: 500,
          maxAmount: 1000,
          purposes: [CreditPurpose.OTHER],
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("rejects credit analyst Carlos from modifying or deactivating a product with 403 Forbidden", async () => {
      const analystCtx = makeContext({
        role: "ANALYST",
        userId: "user-carlos",
      });

      await expect(
        service.update(analystCtx, "prod-1", { name: "Nuevo Nombre" }),
      ).rejects.toThrow(ForbiddenException);

      await expect(service.toggleStatus(analystCtx, "prod-1", false)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe("Aislamiento multi-tenant (CA-16.10)", () => {
    it("does not allow Banco X admin to get or update products belonging to Banco Y", async () => {
      mockDb.client.financialProduct.findFirst.mockResolvedValueOnce(null);

      await expect(service.getById(makeContext(), "prod-from-banco-y")).rejects.toThrow(
        NotFoundException,
      );

      mockDb.client.financialProduct.findFirst.mockResolvedValueOnce(null);

      await expect(
        service.update(makeContext(), "prod-from-banco-y", { name: "Hack Name" }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
