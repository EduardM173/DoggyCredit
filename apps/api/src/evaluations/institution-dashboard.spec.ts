/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { InstitutionDashboardService } from "./institution-dashboard.service.js";
import type { TenantContext } from "../identity-tenants/public.js";

describe("HU-20 — InstitutionDashboardService", () => {
  let service: InstitutionDashboardService;
  let mockDb: any;
  let mockPreparation: any;

  const tenantId = "3a9b0bf8-9a78-4f3c-a6c1-e27a6aecf689";
  const adminCtx: TenantContext = {
    tenantId,
    tenantSlug: "banco-sol",
    tenantName: "Banco Sol S.A.",
    userId: "user-admin-1",
    userName: "Laura Méndez",
    membershipId: "mem-admin-1",
    role: "INSTITUTION_ADMIN",
    taxId: "1020304050",
    institutionType: "BANK",
  };
  const analystCtx: TenantContext = {
    tenantId,
    tenantSlug: "banco-sol",
    tenantName: "Banco Sol S.A.",
    userId: "user-analyst-1",
    userName: "Carlos Morales",
    membershipId: "mem-analyst-1",
    role: "ANALYST",
    taxId: "1020304050",
    institutionType: "BANK",
  };

  beforeEach(() => {
    mockDb = {
      client: {
        evaluation: {
          count: jest.fn(),
          findMany: jest.fn(),
        },
      },
    };
    mockPreparation = {
      read: jest.fn<any>().mockResolvedValue({
        tenant: { name: "Banco Sol S.A.", slug: "banco-sol" },
        ready: true,
        completed: 3,
        steps: { institution: true, source: true, products: true },
      }),
    };
    service = new InstitutionDashboardService(mockDb, mockPreparation);
  });

  it("calculates metrics, completion rates, and catalog compatibility for an active period", async () => {
    mockDb.client.evaluation.count.mockResolvedValue(5);

    mockDb.client.evaluation.findMany.mockImplementation((args: any) => {
      // Pending attention query (status in FAILED, INCOMPLETE)
      if (args?.where?.status?.in) {
        return Promise.resolve([
          {
            id: "eval-failed-1",
            status: "FAILED",
            requestedAmount: "15000",
            applicantSnapshot: { name: "Juan Pérez", type: "PERSON" },
            updatedAt: new Date("2026-10-18T10:00:00Z"),
            failureCode: "BUREAU_UNAVAILABLE",
            failureMessage: "Buró en mantenimiento",
          },
        ]);
      }
      // Period evaluations query
      return Promise.resolve([
        {
          id: "eval-comp-1",
          status: "COMPLETED",
          requestedAmount: "25000",
          applicantSnapshot: { name: "Empresa Alfa", type: "COMPANY" },
          createdAt: new Date(),
          updatedAt: new Date(),
          recommendations: [{ outcome: "RECOMMENDED", product: { active: true } }],
        },
        {
          id: "eval-comp-2",
          status: "COMPLETED",
          requestedAmount: "10000",
          applicantSnapshot: { name: "Pedro Gomez", type: "PERSON" },
          createdAt: new Date(),
          updatedAt: new Date(),
          recommendations: [{ outcome: "NOT_RECOMMENDED", product: { active: true } }],
        },
        {
          id: "eval-failed-1",
          status: "FAILED",
          requestedAmount: "15000",
          applicantSnapshot: { name: "Juan Pérez", type: "PERSON" },
          createdAt: new Date(),
          updatedAt: new Date(),
          recommendations: [],
        },
        {
          id: "eval-inprog-1",
          status: "IN_PROGRESS",
          requestedAmount: "5000",
          applicantSnapshot: { name: "Ana Ruiz", type: "PERSON" },
          createdAt: new Date(),
          updatedAt: new Date(),
          recommendations: [],
        },
      ]);
    });

    const res = await service.getDashboard(adminCtx, "last_30_days");

    expect(res.tenant.slug).toBe("banco-sol");
    expect(res.hasEvaluations).toBe(true);
    expect(res.hasPeriodActivity).toBe(true);
    expect(res.metrics.totalEvaluations).toBe(4);
    expect(res.metrics.byStatus.COMPLETED).toBe(2);
    expect(res.metrics.byStatus.FAILED).toBe(1);
    expect(res.metrics.byStatus.IN_PROGRESS).toBe(1);
    expect(res.metrics.byScope.PERSON).toBe(3);
    expect(res.metrics.byScope.COMPANY).toBe(1);

    // Completion rate: 2 completed out of 3 closed (2 completed + 1 failed) = 66.7%
    expect(res.metrics.completionRate).toBe(66.7);

    // Compatibility rate: 1 compatible out of 2 completed = 50.0%
    expect(res.metrics.catalogCompatibility.rate).toBe(50);
    expect(res.metrics.catalogCompatibility.compatibleCount).toBe(1);

    // Pending attention
    expect(res.attentionRequiredCount).toBe(1);
    expect(res.pendingAttention[0].id).toBe("eval-failed-1");
    expect(res.pendingAttention[0].actionableType).toBe("RETRY");
    expect(res.pendingAttention[0].actionUrl).toBe("/banco-sol/evaluaciones/eval-failed-1");

    // Admin permissions
    expect(res.permissions.canManageTeam).toBe(true);
    expect(res.permissions.canManageProducts).toBe(true);
  });

  it("handles empty periods and zero denominators gracefully (CA-20.08, CA-20.14)", async () => {
    mockDb.client.evaluation.count.mockResolvedValue(0);
    mockDb.client.evaluation.findMany.mockResolvedValue([]);

    const res = await service.getDashboard(analystCtx, "today");

    expect(res.hasEvaluations).toBe(false);
    expect(res.hasPeriodActivity).toBe(false);
    expect(res.metrics.totalEvaluations).toBe(0);
    // Denominator zero returns null (rendered as 'N/A / Datos insuficientes' on UI)
    expect(res.metrics.completionRate).toBeNull();
    expect(res.metrics.catalogCompatibility.rate).toBeNull();
    expect(res.attentionRequiredCount).toBe(0);
    expect(res.pendingAttention).toEqual([]);

    // Analyst does NOT receive admin permissions (CA-20.02)
    expect(res.permissions.canManageTeam).toBe(false);
    expect(res.permissions.canManageProducts).toBe(false);
    expect(res.permissions.canEvaluate).toBe(true);
  });

  it("enforces tenant isolation and passes tenantId into queries (CA-20.06)", async () => {
    mockDb.client.evaluation.count.mockResolvedValue(2);
    mockDb.client.evaluation.findMany.mockResolvedValue([]);

    await service.getDashboard(adminCtx, "last_7_days");

    expect(mockDb.client.evaluation.count).toHaveBeenCalledWith({
      where: { tenantId },
    });
    expect(mockDb.client.evaluation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId }),
      }),
    );
  });
});
