import { jest } from "@jest/globals";
import { ForbiddenException } from "@nestjs/common";
import { TenantPreparationService } from "./tenant-preparation.service.js";
import type { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import type { BankMockSource, BureauMockSource } from "../../financial-integrations/public.js";
import type { PreparationProducts } from "../../recommendations/public.js";
import type { AuditWriter } from "../../audit/public.js";
import type { TenantContext } from "./tenant-context.guard.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockFn = jest.Mock<any>;

describe("TenantPreparationService (HU-13 multi-source enablement)", () => {
  let service: TenantPreparationService;
  let mockDb: {
    client: {
      tenant: {
        findUniqueOrThrow: MockFn;
        update: MockFn;
      };
      $queryRaw: MockFn;
    };
    run: (cb: () => Promise<any>) => Promise<any>;
  };
  let mockBank: {
    status: MockFn;
    enable: MockFn;
  };
  let mockBureau: {
    status: MockFn;
    enable: MockFn;
  };
  let mockProducts: {
    list: MockFn;
    select: MockFn;
  };
  let mockAudit: {
    recordInstitutionPreparation: MockFn;
  };

  const adminCtx: TenantContext = {
    tenantId: "tenant-banco-x",
    userId: "user-ana",
    userName: "Ana María López",
    tenantSlug: "banco-x",
    tenantName: "Banco X",
    membershipId: "mem-ana",
    taxId: "1234567890",
    institutionType: "BANK",
    role: "INSTITUTION_ADMIN",
  };

  const analystCtx: TenantContext = {
    tenantId: "tenant-banco-x",
    userId: "user-carlos",
    userName: "Carlos Analista",
    tenantSlug: "banco-x",
    tenantName: "Banco X",
    membershipId: "mem-carlos",
    taxId: "1234567890",
    institutionType: "BANK",
    role: "ANALYST",
  };

  beforeEach(() => {
    mockDb = {
      client: {
        tenant: {
          findUniqueOrThrow: jest.fn<any>().mockResolvedValue({
            slug: "banco-x",
            legalName: "Banco X",
            taxId: "1234567890",
            institutionType: "BANK",
            informationConfirmedAt: new Date("2026-10-01"),
            productsConfirmedAt: new Date("2026-10-01"),
          }),
          update: jest.fn(),
        },
        $queryRaw: jest.fn<any>().mockResolvedValue([]),
      },
      run: async (cb) => cb(),
    };

    mockBank = {
      status: jest.fn<any>().mockResolvedValue({
        available: true,
        enabled: true,
        healthStatus: "ACTIVE",
      }),
      enable: jest.fn<any>().mockResolvedValue(true),
    };

    mockBureau = {
      status: jest.fn<any>().mockResolvedValue({
        available: true,
        enabled: false,
        healthStatus: "ACTIVE",
      }),
      enable: jest.fn<any>().mockResolvedValue(true),
    };

    mockProducts = {
      list: jest.fn<any>().mockResolvedValue([
        { id: "prod-1", name: "Microcrédito", selected: true, applicantScope: "PERSON" },
      ]),
      select: jest.fn<any>().mockResolvedValue(true),
    };

    mockAudit = {
      recordInstitutionPreparation: jest.fn<any>().mockResolvedValue(undefined),
    };

    service = new TenantPreparationService(
      mockDb as unknown as DatabaseUnitOfWork,
      mockBank as unknown as BankMockSource,
      mockBureau as unknown as BureauMockSource,
      mockProducts as unknown as PreparationProducts,
      mockAudit as unknown as AuditWriter,
    );
  });

  describe("read", () => {
    it("returns sources list including BANK_MOCK and BUREAU_MOCK with coverage and status", async () => {
      const res = await service.read(adminCtx);

      expect(res.tenant.name).toBe("Banco X");
      expect(res.sources).toHaveLength(2);

      const bank = res.sources.find((s) => s.code === "BANK_MOCK");
      expect(bank).toBeDefined();
      expect(bank?.enabled).toBe(true);
      expect(bank?.available).toBe(true);
      expect(bank?.healthStatus).toBe("ACTIVE");
      expect(bank?.coverage).toContain("Personas y microempresas");

      const bureau = res.sources.find((s) => s.code === "BUREAU_MOCK");
      expect(bureau).toBeDefined();
      expect(bureau?.enabled).toBe(false);
      expect(bureau?.available).toBe(true);
      expect(bureau?.healthStatus).toBe("ACTIVE");
      expect(bureau?.coverage).toContain("solicitantes particulares");

      // Backward compatibility with step 2
      expect(res.source.enabled).toBe(true);
    });
  });

  describe("enableBureau", () => {
    it("enables Bureau Mock for the admin tenant and records audit log (PA-13.01)", async () => {
      mockBureau.enable.mockResolvedValueOnce(true);
      // After enable, bureau status reflects enabled: true
      mockBureau.status.mockResolvedValueOnce({
        available: true,
        enabled: false,
        healthStatus: "ACTIVE",
      }).mockResolvedValueOnce({
        available: true,
        enabled: true,
        healthStatus: "ACTIVE",
      });

      const res = await service.enableBureau(adminCtx, true);

      expect(mockBureau.enable).toHaveBeenCalledWith("tenant-banco-x", true);
      expect(mockAudit.recordInstitutionPreparation).toHaveBeenCalledWith({
        tenantId: "tenant-banco-x",
        actorUserId: "user-ana",
        action: "BUREAU_MOCK_ENABLED",
      });
      expect(res.sources.find((s) => s.code === "BUREAU_MOCK")?.enabled).toBe(true);
    });

    it("can disable Bureau Mock and records BUREAU_MOCK_DISABLED audit log", async () => {
      mockBureau.enable.mockResolvedValueOnce(true);

      await service.enableBureau(adminCtx, false);

      expect(mockBureau.enable).toHaveBeenCalledWith("tenant-banco-x", false);
      expect(mockAudit.recordInstitutionPreparation).toHaveBeenCalledWith({
        tenantId: "tenant-banco-x",
        actorUserId: "user-ana",
        action: "BUREAU_MOCK_DISABLED",
      });
    });

    it("rejects non-admin users with 403 Forbidden (PA-13.03)", async () => {
      await expect(service.enableBureau(analystCtx, true)).rejects.toThrow(ForbiddenException);
      expect(mockBureau.enable).not.toHaveBeenCalled();
      expect(mockAudit.recordInstitutionPreparation).not.toHaveBeenCalled();
    });

    it("guarantees tenant isolation: operation affects only context tenant (PA-13.03)", async () => {
      await service.enableBureau(adminCtx, true);
      expect(mockBureau.enable).toHaveBeenCalledWith("tenant-banco-x", true);
      expect(mockBureau.enable).not.toHaveBeenCalledWith("tenant-banco-y", expect.anything());
    });
  });
});
