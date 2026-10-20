/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { TenantPlanMeteringController } from "./tenant-plan-metering.controller.js";
import type { TenantPlanMeteringService } from "./tenant-plan-metering.service.js";

describe("HU-21 TenantPlanMeteringController", () => {
  let controller: TenantPlanMeteringController;
  let mockService: Partial<TenantPlanMeteringService>;

  beforeEach(() => {
    mockService = {
      getTenantPlanAndUsage: jest.fn<any>().mockResolvedValue({
        tenant: { id: "t-1", name: "Banco X", slug: "banco-x" },
        capacity: { state: "LIMITADO", limit: 50, consumed: 10 },
      }),
    };

    controller = new TenantPlanMeteringController(mockService as TenantPlanMeteringService);
  });

  it("passes tenantId and role from request tenantContext to the service", async () => {
    const mockReq = {
      tenantContext: {
        tenantId: "t-1",
        tenantSlug: "banco-x",
        tenantName: "Banco X",
        role: "INSTITUTION_ADMIN",
      },
    } as any;

    const res = await controller.getPlanAndUsage(mockReq);

    expect(mockService.getTenantPlanAndUsage).toHaveBeenCalledWith("t-1", "INSTITUTION_ADMIN");
    expect(res.tenant.slug).toBe("banco-x");
  });
});
