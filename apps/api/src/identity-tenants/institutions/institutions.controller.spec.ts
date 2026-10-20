import { describe, expect, it, jest } from "@jest/globals";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { InstitutionsController } from "./institutions.controller.js";
import { AdminAuthGuard, OperatorGuard } from "../auth/admin-auth.guards.js";
import type { InstitutionsService } from "./institutions.service.js";

describe("HU-22 InstitutionsController", () => {
  const mockService = {
    list: jest.fn().mockImplementation(() =>
      Promise.resolve({ items: [], total: 0, page: 1, pageSize: 10 }),
    ),
    getDetail: jest.fn().mockImplementation(() =>
      Promise.resolve({ institution: { tenantId: "tenant-1" } }),
    ),
  } as unknown as InstitutionsService;

  it("is guarded by AdminAuthGuard and OperatorGuard (CA-22.08)", () => {
    const guards = (Reflect.getMetadata(GUARDS_METADATA, InstitutionsController) as { name: string }[]).map(
      (g) => g.name,
    );
    expect(guards).toContain(AdminAuthGuard.name);
    expect(guards).toContain(OperatorGuard.name);
  });

  it("delegates list to institutions service", async () => {
    const controller = new InstitutionsController(mockService);
    await controller.list({ page: 1, pageSize: 10 });
    expect(mockService.list).toHaveBeenCalledWith({ page: 1, pageSize: 10 });
  });

  it("delegates getDetail to institutions service", async () => {
    const controller = new InstitutionsController(mockService);
    await controller.getDetail("tenant-1");
    expect(mockService.getDetail).toHaveBeenCalledWith("tenant-1");
  });
});
