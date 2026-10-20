import { describe, expect, it, jest } from "@jest/globals";
import { ForbiddenException } from "@nestjs/common";
import { InstitutionAuditController } from "./institution-audit.controller.js";
import type { AuditReader, AuditPageDto } from "./public.js";
import type { TenantRequest } from "../identity-tenants/public.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
describe("InstitutionAuditController (HU-24)", () => {
  it("permite el acceso a un INSTITUTION_ADMIN y consulta por tenantId", async () => {
    const mockAuditPage: AuditPageDto = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    };
    const queryInstitutionAudit = jest.fn<any>().mockResolvedValue(mockAuditPage);
    const auditReader = { queryInstitutionAudit } as unknown as AuditReader;

    const controller = new InstitutionAuditController(auditReader);

    const request = {
      tenantContext: {
        tenantId: "tenant-sol-id",
        tenantSlug: "banco-sol",
        role: "INSTITUTION_ADMIN",
        userId: "user-ana",
      },
    } as unknown as TenantRequest;

    const result = await controller.list(request, { page: 1, pageSize: 20 });

    expect(result).toBe(mockAuditPage);
    expect(queryInstitutionAudit).toHaveBeenCalledWith(
      "tenant-sol-id",
      { page: 1, pageSize: 20 },
      "banco-sol",
    );
  });

  it("rechaza con 403 Forbidden al analista (Carlos)", async () => {
    const auditReader = { queryInstitutionAudit: jest.fn() } as unknown as AuditReader;
    const controller = new InstitutionAuditController(auditReader);

    const request = {
      tenantContext: {
        tenantId: "tenant-sol-id",
        tenantSlug: "banco-sol",
        role: "ANALYST",
        userId: "user-carlos",
      },
    } as unknown as TenantRequest;

    await expect(controller.list(request, { page: 1, pageSize: 20 })).rejects.toThrow(
      ForbiddenException,
    );
  });
});
