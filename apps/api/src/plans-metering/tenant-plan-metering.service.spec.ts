/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { TenantPlanMeteringService, getCycleBounds } from "./tenant-plan-metering.service.js";

describe("HU-21 TenantPlanMeteringService — Consultar plan contratado, capacidades y consumo institucional", () => {
  let service: TenantPlanMeteringService;
  let mockDb: any;

  const mockTenant = {
    id: "tenant-banco-x",
    legalName: "Banco X S.A.",
    slug: "banco-x",
  };

  const mockPlanBasic = {
    id: "plan-basic-id",
    code: "BASIC",
    name: "Plan Básico",
    description: "Para cooperativas y financieras emergentes",
    evaluationsPerMonth: 50,
    evaluationLimitMode: "LIMITADO",
    maxUsers: 3,
    scoringEnabled: false,
    price: 0,
    currency: "BOB",
    billingPeriod: "MONTHLY",
    requiresPayment: false,
    features: ["Banco Mock", "Evaluaciones guiadas"],
  };

  const mockPlanEnterprise = {
    id: "plan-ent-id",
    code: "ENTERPRISE",
    name: "Plan Empresarial",
    description: "Para bancos de primer orden",
    evaluationsPerMonth: null, // Unlimited
    evaluationLimitMode: "ILIMITADO",
    maxUsers: null,
    scoringEnabled: true,
    price: 799,
    currency: "BOB",
    billingPeriod: "MONTHLY",
    requiresPayment: true,
    features: ["Banco Mock", "Buró Mock", "Resiliencia"],
  };

  beforeEach(() => {
    mockDb = {
      client: {
        tenant: {
          findUnique: jest.fn(),
        },
        tenantSubscription: {
          findFirst: jest.fn(),
        },
        usageRecord: {
          count: jest.fn(),
          create: jest.fn(),
        },
      },
    };

    service = new TenantPlanMeteringService(mockDb);
  });

  describe("getCycleBounds", () => {
    it("computes monthly boundaries in America/La_Paz timezone", () => {
      const refDate = new Date("2026-10-20T12:00:00.000Z");
      const { start, end } = getCycleBounds(refDate);

      // October 2026 in America/La_Paz: start is 2026-10-01T04:00:00.000Z
      expect(start.toISOString()).toBe("2026-10-01T04:00:00.000Z");
      // End is 2026-11-01T04:00:00.000Z
      expect(end.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    });
  });

  describe("getTenantPlanAndUsage", () => {
    it("throws NotFoundException if tenant does not exist", async () => {
      mockDb.client.tenant.findUnique.mockResolvedValue(null);

      await expect(service.getTenantPlanAndUsage("unknown-id", "INSTITUTION_ADMIN")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("returns LIMITADO plan with usage and remaining capacity for Ana (Admin)", async () => {
      mockDb.client.tenant.findUnique.mockResolvedValue(mockTenant);
      mockDb.client.tenantSubscription.findFirst.mockResolvedValue({
        id: "sub-1",
        tenantId: mockTenant.id,
        planId: mockPlanBasic.id,
        status: "ACTIVE",
        startsAt: new Date("2026-10-01T04:00:00.000Z"),
        endsAt: null,
        plan: mockPlanBasic,
      });
      mockDb.client.usageRecord.count.mockResolvedValue(12);

      const result = await service.getTenantPlanAndUsage(
        mockTenant.id,
        "INSTITUTION_ADMIN",
        new Date("2026-10-20T12:00:00.000Z"),
      );

      expect(result.tenant.name).toBe("Banco X S.A.");
      expect(result.subscription.status).toBe("ACTIVE");
      expect(result.plan?.code).toBe("BASIC");
      expect(result.capacity.state).toBe("LIMITADO");
      expect(result.capacity.limit).toBe(50);
      expect(result.capacity.consumed).toBe(12);
      expect(result.capacity.remaining).toBe(38);
      expect(result.capacity.percentage).toBe(24);
      expect(result.capacity.isExceeded).toBe(false);
      expect(result.permissions.canViewCommercialTerms).toBe(true);
      expect(result.permissions.canEvaluate).toBe(true);
      expect(result.environment.isSimulation).toBe(true);
    });

    it("returns ILIMITADO plan without limit or remaining quota for Enterprise plan", async () => {
      mockDb.client.tenant.findUnique.mockResolvedValue(mockTenant);
      mockDb.client.tenantSubscription.findFirst.mockResolvedValue({
        id: "sub-ent",
        tenantId: mockTenant.id,
        planId: mockPlanEnterprise.id,
        status: "ACTIVE",
        startsAt: new Date("2026-10-01T04:00:00.000Z"),
        endsAt: null,
        plan: mockPlanEnterprise,
      });
      mockDb.client.usageRecord.count.mockResolvedValue(550);

      const result = await service.getTenantPlanAndUsage(
        mockTenant.id,
        "INSTITUTION_ADMIN",
        new Date("2026-10-20T12:00:00.000Z"),
      );

      expect(result.capacity.state).toBe("ILIMITADO");
      expect(result.capacity.limit).toBeNull();
      expect(result.capacity.remaining).toBeNull();
      expect(result.capacity.percentage).toBeNull();
      expect(result.capacity.isExceeded).toBe(false);
      expect(result.capacity.consumed).toBe(550);
    });

    it("returns NO_CONFIGURADO when tenant has no subscription at all", async () => {
      mockDb.client.tenant.findUnique.mockResolvedValue(mockTenant);
      mockDb.client.tenantSubscription.findFirst.mockResolvedValue(null);

      const result = await service.getTenantPlanAndUsage(mockTenant.id, "INSTITUTION_ADMIN");

      expect(result.capacity.state).toBe("NO_CONFIGURADO");
      expect(result.subscription.status).toBe("NO_SUBSCRIPTION");
      expect(result.plan).toBeNull();
      expect(result.permissions.canEvaluate).toBe(false);
    });

    it("returns NO_DISPONIBLE when subscription is SUSPENDED", async () => {
      mockDb.client.tenant.findUnique.mockResolvedValue(mockTenant);
      // First call for ACTIVE returns null
      mockDb.client.tenantSubscription.findFirst
        .mockResolvedValueOnce(null)
        // Second call for any returns SUSPENDED
        .mockResolvedValueOnce({
          id: "sub-suspended",
          status: "SUSPENDED",
          startsAt: new Date("2026-09-01T00:00:00.000Z"),
          endsAt: new Date("2026-10-01T00:00:00.000Z"),
        });

      const result = await service.getTenantPlanAndUsage(mockTenant.id, "INSTITUTION_ADMIN");

      expect(result.capacity.state).toBe("NO_DISPONIBLE");
      expect(result.subscription.status).toBe("SUSPENDED");
      expect(result.permissions.canEvaluate).toBe(false);
    });

    it("sets canViewCommercialTerms to false for Carlos the Analyst (CA-21.05)", async () => {
      mockDb.client.tenant.findUnique.mockResolvedValue(mockTenant);
      mockDb.client.tenantSubscription.findFirst.mockResolvedValue({
        id: "sub-1",
        status: "ACTIVE",
        startsAt: new Date(),
        endsAt: null,
        plan: mockPlanBasic,
      });
      mockDb.client.usageRecord.count.mockResolvedValue(5);

      const result = await service.getTenantPlanAndUsage(mockTenant.id, "ANALYST");

      expect(result.permissions.canViewCommercialTerms).toBe(false);
      expect(result.permissions.role).toBe("ANALYST");
    });
  });

  describe("checkQuotaAvailable", () => {
    it("permits processing when quota is within limits", async () => {
      mockDb.client.tenantSubscription.findFirst.mockResolvedValue({
        id: "sub-1",
        status: "ACTIVE",
        plan: mockPlanBasic,
      });
      mockDb.client.usageRecord.count.mockResolvedValue(49); // 49 of 50

      await expect(service.checkQuotaAvailable(mockTenant.id, "INSTITUTION_ADMIN")).resolves.toBeUndefined();
    });

    it("throws PLAN_QUOTA_EXCEEDED with admin guidance when consumed >= limit for Admin (CA-21.04)", async () => {
      mockDb.client.tenantSubscription.findFirst.mockResolvedValue({
        id: "sub-1",
        status: "ACTIVE",
        plan: mockPlanBasic,
      });
      mockDb.client.usageRecord.count.mockResolvedValue(50); // 50 of 50 reached

      try {
        await service.checkQuotaAvailable(mockTenant.id, "INSTITUTION_ADMIN");
        throw new Error("Expected ForbiddenException");
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const res = (err as ForbiddenException).getResponse() as any;
        expect(res.code).toBe("PLAN_QUOTA_EXCEEDED");
        expect(res.consumed).toBe(50);
        expect(res.limit).toBe(50);
        expect(res.message).toContain("límite mensual de 50 evaluaciones");
      }
    });

    it("throws PLAN_QUOTA_EXCEEDED with contact-admin message for Analyst (CA-21.05)", async () => {
      mockDb.client.tenantSubscription.findFirst.mockResolvedValue({
        id: "sub-1",
        status: "ACTIVE",
        plan: mockPlanBasic,
      });
      mockDb.client.usageRecord.count.mockResolvedValue(50);

      try {
        await service.checkQuotaAvailable(mockTenant.id, "ANALYST");
        throw new Error("Expected ForbiddenException");
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const res = (err as ForbiddenException).getResponse() as any;
        expect(res.code).toBe("PLAN_QUOTA_EXCEEDED");
        expect(res.message).toContain("Contacta a tu administrador");
      }
    });

    it("permits processing without limits for ILIMITADO plan", async () => {
      mockDb.client.tenantSubscription.findFirst.mockResolvedValue({
        id: "sub-ent",
        status: "ACTIVE",
        plan: mockPlanEnterprise, // evaluationsPerMonth: null
      });

      await expect(service.checkQuotaAvailable(mockTenant.id, "ANALYST")).resolves.toBeUndefined();
      expect(mockDb.client.usageRecord.count).not.toHaveBeenCalled();
    });
  });

  describe("recordEvaluationUsage", () => {
    it("creates a UsageRecord with idempotencyKey usage_eval_${id}", async () => {
      mockDb.client.usageRecord.create.mockResolvedValue({ id: "rec-1" } as any);

      const recorded = await service.recordEvaluationUsage(mockTenant.id, "eval-xyz");

      expect(recorded).toBe(true);
      expect(mockDb.client.usageRecord.create).toHaveBeenCalledWith({
        data: {
          tenantId: mockTenant.id,
          metric: "EVALUATION",
          quantity: 1,
          referenceType: "Evaluation",
          referenceId: "eval-xyz",
          idempotencyKey: "usage_eval_eval-xyz",
        },
      });
    });

    it("absorbs unique constraint error idempotently without throwing (CA-21.03, CA-21.13)", async () => {
      const p2002Err = new Error("Unique constraint failed on the fields: (`idempotencyKey`)");
      (p2002Err as any).code = "P2002";
      mockDb.client.usageRecord.create.mockRejectedValue(p2002Err);

      const recorded = await service.recordEvaluationUsage(mockTenant.id, "eval-xyz");

      expect(recorded).toBe(false); // Idempotently absorbed, no error thrown
    });
  });
});
