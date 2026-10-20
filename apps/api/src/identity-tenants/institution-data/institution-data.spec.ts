import { jest } from "@jest/globals";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { InstitutionDataService, INSTITUTION_DATA_SUPPORT_MESSAGE } from "./institution-data.service.js";
import type { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import type { AuditWriter } from "../../audit/public.js";
import type { TenantContext } from "../institution-auth/tenant-context.guard.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockFn = jest.Mock<any>;

describe("InstitutionDataService (HU-34 editable institution data)", () => {
  let service: InstitutionDataService;
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
  let mockAudit: { recordInstitutionDataUpdate: MockFn };

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

  const analystCtx: TenantContext = { ...adminCtx, userId: "user-carlos", role: "ANALYST" };

  const tenantRow = {
    slug: "banco-x",
    legalName: "Banco X S.A.",
    taxId: "1234567890",
    publicAddress: "Calle 1 #2-3",
    contactPhone: "+57 300 000 0000",
    contactEmail: "contacto@banco-x.co",
    supportPhone: "+57 601 000 0000",
    supportEmail: "soporte@banco-x.co",
    createdFromRequest: { contactName: "Ana María López", contactRole: "Representante", reviewedAt: new Date("2026-10-01") },
  };

  beforeEach(() => {
    mockDb = {
      client: {
        tenant: {
          findUniqueOrThrow: jest.fn<any>().mockResolvedValue(tenantRow),
          update: jest.fn<any>().mockResolvedValue(tenantRow),
        },
        $queryRaw: jest.fn<any>().mockResolvedValue([]),
      },
      run: async (cb) => cb(),
    };
    mockAudit = { recordInstitutionDataUpdate: jest.fn<any>().mockResolvedValue(undefined) };
    service = new InstitutionDataService(
      mockDb as unknown as DatabaseUnitOfWork,
      mockAudit as unknown as AuditWriter,
    );
  });

  describe("read (CA-34.01, CA-34.03)", () => {
    it("returns every field with its provenance and editable flag", async () => {
      const res = await service.read(adminCtx);
      expect(res.tenantSlug).toBe("banco-x");
      expect(res.supportMessage).toBe(INSTITUTION_DATA_SUPPORT_MESSAGE);
      for (const field of res.fields) expect(field.provenance).toBeTruthy();

      const locked = res.fields.filter((field) => !field.editable).map((field) => field.key);
      expect(locked).toEqual(
        expect.arrayContaining(["legalName", "taxId", "tenantSlug", "contractualResponsible"]),
      );

      const editable = res.fields.filter((field) => field.editable).map((field) => field.key);
      expect(editable).toEqual(
        expect.arrayContaining(["publicAddress", "contactPhone", "contactEmail", "supportPhone", "supportEmail"]),
      );
    });
  });

  describe("update (CA-34.02, CA-34.04)", () => {
    it("updates only authorized fields and records an audit log", async () => {
      mockDb.client.tenant.findUniqueOrThrow
        .mockResolvedValueOnce({ publicAddress: "Calle 1 #2-3", contactPhone: "+57 300 000 0000", contactEmail: "contacto@banco-x.co", supportPhone: null, supportEmail: null })
        .mockResolvedValueOnce({ ...tenantRow, publicAddress: "Calle 9 #9-9" });

      await service.update(adminCtx, { publicAddress: "Calle 9 #9-9" });

      expect(mockDb.client.tenant.update).toHaveBeenCalledWith({
        where: { id: "tenant-banco-x" },
        data: { publicAddress: "Calle 9 #9-9" },
      });
      expect(mockAudit.recordInstitutionDataUpdate).toHaveBeenCalledWith({
        tenantId: "tenant-banco-x",
        actorUserId: "user-ana",
        changedFields: ["publicAddress"],
      });
    });

    it("does not audit when the value is unchanged", async () => {
      mockDb.client.tenant.findUniqueOrThrow
        .mockResolvedValueOnce({ publicAddress: "Calle 1 #2-3", contactPhone: null, contactEmail: null, supportPhone: null, supportEmail: null })
        .mockResolvedValueOnce(tenantRow);

      await service.update(adminCtx, { publicAddress: "Calle 1 #2-3" });

      expect(mockDb.client.tenant.update).not.toHaveBeenCalled();
      expect(mockAudit.recordInstitutionDataUpdate).not.toHaveBeenCalled();
    });

    it("rejects non-admin users with 403 Forbidden (CA-34.05)", async () => {
      await expect(service.update(analystCtx, { publicAddress: "Calle 9 #9-9" })).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockDb.client.tenant.update).not.toHaveBeenCalled();
      expect(mockAudit.recordInstitutionDataUpdate).not.toHaveBeenCalled();
    });

    it("rejects requests without authorized fields", async () => {
      await expect(service.update(adminCtx, {})).rejects.toThrow(BadRequestException);
    });

    it("guarantees tenant isolation: only the context tenant is written (CA-34.05)", async () => {
      mockDb.client.tenant.findUniqueOrThrow
        .mockResolvedValueOnce({ publicAddress: null, contactPhone: null, contactEmail: null, supportPhone: null, supportEmail: null })
        .mockResolvedValueOnce(tenantRow);

      await service.update(adminCtx, { contactEmail: "nuevo@banco-x.co" });

      expect(mockDb.client.tenant.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "tenant-banco-x" } }),
      );
      expect(mockDb.client.tenant.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "tenant-banco-y" } }),
      );
    });
  });
});
