import { describe, expect, it, jest } from "@jest/globals";
import { NotFoundException } from "@nestjs/common";
import { InstitutionsService } from "./institutions.service.js";
import type { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import type {
  IntegrationHealthSummary,
  ProviderHealthReadService,
} from "../../financial-integrations/public.js";

describe("HU-22 InstitutionsService", () => {
  const mockTenant = {
    id: "tenant-uuid-1",
    slug: "banco-sol",
    legalName: "Banco Solidario S.A.",
    taxId: "1020304050",
    institutionType: "BANK",
    status: "ACTIVE",
    createdFromRequest: { reviewedAt: new Date("2026-10-01T10:00:00Z") },
    memberships: [
      {
        id: "mem-1",
        role: "INSTITUTION_ADMIN",
        status: "ACTIVE",
        isInitialAdmin: true,
        createdAt: new Date("2026-10-01T10:00:00Z"),
        user: { fullName: "Ana Lopez", email: "ana@bancosol.bo" },
      },
      {
        id: "mem-2",
        role: "ANALYST",
        status: "ACTIVE",
        isInitialAdmin: false,
        createdAt: new Date("2026-10-05T12:00:00Z"),
        user: { fullName: "Carlos Quispe", email: "carlos@bancosol.bo" },
      },
    ],
    _count: { memberships: 2 },
    subscriptions: [
      {
        id: "sub-1",
        status: "ACTIVE",
        startsAt: new Date("2026-10-01T04:00:00Z"),
        endsAt: null,
        plan: {
          id: "plan-basic",
          code: "BASIC",
          name: "Plan Básico",
          price: 0,
          currency: "BOB",
          billingPeriod: "MONTHLY",
          evaluationsPerMonth: 50,
          maxUsers: 3,
        },
      },
    ],
    integrations: [
      {
        provider: { code: "BANK_MOCK", name: "Banco Central Mock", globallyEnabled: true },
        enabled: true,
      },
      {
        provider: { code: "BUREAU_MOCK", name: "Buró de Crédito Mock", globallyEnabled: true },
        enabled: true,
      },
    ],
  };

  const createMockDb = (overrides?: Record<string, unknown>): DatabaseUnitOfWork => {
    const client = {
      tenant: {
        count: jest.fn().mockImplementation(() => Promise.resolve(1)),
        findMany: jest.fn().mockImplementation(() => Promise.resolve([mockTenant])),
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(mockTenant)),
      },
      usageRecord: {
        groupBy: jest.fn().mockImplementation(() =>
          Promise.resolve([{ tenantId: "tenant-uuid-1", _count: { _all: 15 } }]),
        ),
        count: jest.fn().mockImplementation(() => Promise.resolve(15)),
      },
      ...overrides,
    };
    return {
      client,
      run: jest.fn((fn: unknown) => (typeof fn === "function" ? (fn as () => unknown)() : fn)),
    } as unknown as DatabaseUnitOfWork;
  };

  const createMockHealth = (healthOverrides?: IntegrationHealthSummary[]): ProviderHealthReadService =>
    ({
      list: jest.fn().mockImplementation(() =>
        Promise.resolve(
          healthOverrides ?? [
            {
              code: "BANK_MOCK",
              name: "Banco Central Mock",
              globallyEnabled: true,
              health: { state: "OPERATIVO_OBSERVADO", lastSignalAt: "2026-10-20T12:00:00Z", confidence: "HIGH" },
              tenants: { enabled: 1, affected: { known: true, count: 0 } },
            },
            {
              code: "BUREAU_MOCK",
              name: "Buró de Crédito Mock",
              globallyEnabled: true,
              health: { state: "OPERATIVO_OBSERVADO", lastSignalAt: "2026-10-20T12:00:00Z", confidence: "HIGH" },
              tenants: { enabled: 1, affected: { known: true, count: 0 } },
            },
          ],
        ),
      ),
    }) as unknown as ProviderHealthReadService;

  it("list() returns institutions with RF-03 capacity, plan and integration health", async () => {
    const db = createMockDb();
    const health = createMockHealth();
    const service = new InstitutionsService(db, health);

    const result = await service.list({ page: 1, pageSize: 10 });

    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.tenantId).toBe("tenant-uuid-1");
    expect(item.institutionName).toBe("Banco Solidario S.A.");
    expect(item.nit).toBe("1020304050");
    expect(item.initialAdmin.name).toBe("Ana Lopez");
    expect(item.activationStatus).toBe("ACTIVE");
    expect(item.plan).toEqual({ code: "BASIC", name: "Plan Básico" });
    // CA-22.03: Capacity conforming to RF-03 (15 consumed out of 50 = 30%)
    expect(item.capacity).toEqual({
      state: "LIMITADO",
      consumed: 15,
      limit: 50,
      percentage: 30,
    });
    expect(item.membersCount).toBe(2);
    expect(item.integrationsHealth).toEqual({
      state: "OPERATIVO_OBSERVADO",
      label: "Operativo (observado)",
      hasDegraded: false,
      degradedProviderCode: undefined,
    });
  });

  it("list() identifies degraded integrations for tenant and flags navigation target (CA-22.06)", async () => {
    const db = createMockDb();
    const health = createMockHealth([
      {
        code: "BANK_MOCK",
        name: "Banco Central Mock",
        globallyEnabled: true,
        health: { state: "OPERATIVO_OBSERVADO", lastSignalAt: null, confidence: "HIGH" },
        tenants: { enabled: 1, affected: { known: true, count: 0 } },
      },
      {
        code: "BUREAU_MOCK",
        name: "Buró de Crédito Mock",
        globallyEnabled: true,
        health: { state: "DEGRADADO_OBSERVADO", lastSignalAt: "2026-10-20T12:00:00Z", confidence: "HIGH" },
        tenants: { enabled: 1, affected: { known: true, count: 1 } },
      },
    ]);
    const service = new InstitutionsService(db, health);

    const result = await service.list({ page: 1, pageSize: 10 });
    const item = result.items[0];

    expect(item.integrationsHealth.hasDegraded).toBe(true);
    expect(item.integrationsHealth.state).toBe("DEGRADADO_OBSERVADO");
    expect(item.integrationsHealth.degradedProviderCode).toBe("BUREAU_MOCK");
  });

  it("getDetail() returns 404 when tenant is not found", async () => {
    const db = createMockDb({
      tenant: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(null)),
      },
    });
    const health = createMockHealth();
    const service = new InstitutionsService(db, health);

    await expect(service.getDetail("unknown-id")).rejects.toThrow(NotFoundException);
  });

  it("getDetail() returns operational detail without applicant financial PII (CA-22.05, CA-22.10)", async () => {
    const db = createMockDb();
    const health = createMockHealth();
    const service = new InstitutionsService(db, health);

    const detail = await service.getDetail("tenant-uuid-1");

    expect(detail.institution.institutionName).toBe("Banco Solidario S.A.");
    expect(detail.subscription.status).toBe("ACTIVE");
    expect(detail.plan?.name).toBe("Plan Básico");
    expect(detail.capacity.consumed).toBe(15);
    expect(detail.capacity.limit).toBe(50);
    expect(detail.capacity.remaining).toBe(35);
    expect(detail.capacity.isExceeded).toBe(false);

    // Members summary
    expect(detail.membershipsSummary.totalUsers).toBe(2);
    expect(detail.membershipsSummary.adminsCount).toBe(1);
    expect(detail.membershipsSummary.analystsCount).toBe(1);

    // Security: no token hashes or passwords
    const recordDetail = detail as unknown as Record<string, unknown>;
    for (const member of detail.membershipsSummary.members) {
      const recordMember = member as unknown as Record<string, unknown>;
      expect(recordMember.tokenHash).toBeUndefined();
      expect(recordMember.passwordHash).toBeUndefined();
    }

    // Privacy notice
    expect(detail.privacyNotice).toContain("secreto bancario y privacidad");

    // Strictly NO client dossiers, NO applicant CI/NIT, NO debts or bureau scores
    expect(recordDetail.clients).toBeUndefined();
    expect(recordDetail.evaluations).toBeUndefined();
    expect(recordDetail.applicantSnapshot).toBeUndefined();
    expect(recordDetail.debts).toBeUndefined();
    expect(recordDetail.incomes).toBeUndefined();
  });
});
