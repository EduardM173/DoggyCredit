/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, jest } from "@jest/globals";
import { InstitutionDashboardController } from "./institution-dashboard.controller.js";
import type { InstitutionDashboardService, DashboardMetricsDto } from "./institution-dashboard.service.js";
import type { TenantRequest } from "../identity-tenants/public.js";

describe("InstitutionDashboardController", () => {
  it("delegates to service with tenantContext and period query parameter", async () => {
    const mockDto: Partial<DashboardMetricsDto> = {
      tenant: { id: "t1", name: "Banco Sol", slug: "banco-sol" },
      metrics: {
        totalEvaluations: 10,
        completionRate: 80,
        byStatus: { COMPLETED: 8, IN_PROGRESS: 1, INCOMPLETE: 1, FAILED: 0, DRAFT: 0 },
        byScope: { PERSON: 8, COMPANY: 2 },
        catalogCompatibility: { rate: 75, compatibleCount: 6, incompatibleCount: 2 },
      },
    };

    const mockService = {
      getDashboard: jest.fn<any>().mockResolvedValue(mockDto),
    };

    const controller = new InstitutionDashboardController(mockService as unknown as InstitutionDashboardService);

    const request = {
      tenantContext: {
        tenantId: "t1",
        tenantSlug: "banco-sol",
        role: "INSTITUTION_ADMIN",
      },
    } as unknown as TenantRequest;

    const result = await controller.getDashboard(request, "last_7_days");

    expect(mockService.getDashboard).toHaveBeenCalledWith(request.tenantContext, "last_7_days");
    expect(result).toEqual(mockDto);
  });
});
