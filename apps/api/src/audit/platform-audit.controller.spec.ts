import { describe, expect, it, jest } from "@jest/globals";
import { PlatformAuditController } from "./platform-audit.controller.js";
import type { AuditReader, AuditPageDto } from "./public.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
describe("PlatformAuditController (HU-24)", () => {
  it("permite consultar la auditoría operativa de plataforma", async () => {
    const mockAuditPage: AuditPageDto = {
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    };
    const queryPlatformAudit = jest.fn<any>().mockResolvedValue(mockAuditPage);
    const auditReader = { queryPlatformAudit } as unknown as AuditReader;

    const controller = new PlatformAuditController(auditReader);

    const result = await controller.list({ page: 1, pageSize: 20 });

    expect(result).toBe(mockAuditPage);
    expect(queryPlatformAudit).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });
});
