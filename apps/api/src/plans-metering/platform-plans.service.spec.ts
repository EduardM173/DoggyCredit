import { describe, expect, it, jest } from "@jest/globals";
import { ConflictException } from "@nestjs/common";
import { ForbiddenException, ValidationPipe, type ExecutionContext } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { Prisma } from "../generated/prisma/client.js";
import { PlatformPlansService } from "./platform-plans.service.js";
import { contractedTerms, isOfferEligible, planTerms } from "./plan-terms.js";
import { PlatformPlansController } from "./platform-plans.controller.js";
import { CreatePlanDto, UpdatePlanDto } from "./platform-plans.dto.js";
import { AdminAuthGuard, PlatformAdminGuard } from "../identity-tenants/public.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import type { AuditWriter } from "../audit/public.js";

const plan = {
  id: "plan-1",
  code: "PRO",
  name: "Profesional",
  description: null,
  price: new Prisma.Decimal("100.00"),
  currency: "BOB",
  billingPeriod: "MONTHLY",
  requiresPayment: true,
  evaluationLimitMode: "LIMITADO" as const,
  evaluationsPerMonth: 50,
  maxUsers: 5,
  features: ["Evaluaciones"],
  scoringEnabled: false,
  active: true,
  isPublic: true,
  revision: 1,
  effectiveFrom: new Date("2026-10-01T00:00:00Z"),
};
const body = {
  name: "Profesional",
  description: null,
  price: "120.00",
  currency: "BOB" as const,
  billingPeriod: "MONTHLY" as const,
  requiresPayment: true,
  evaluationLimitMode: "LIMITADO" as const,
  evaluationsPerMonth: 75,
  maxUsers: 5,
  features: ["Evaluaciones"],
  expectedRevision: 1,
};

describe("HU-29 catálogo y derechos contratados", () => {
  it("protege el catálogo por rol y exige origen administrativo en escrituras", () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, PlatformPlansController)).toEqual([
      AdminAuthGuard,
      PlatformAdminGuard,
    ]);
    const guard = new PlatformAdminGuard();
    const context = (platformRole: string) =>
      ({
        switchToHttp: () => ({
          getRequest: () => ({ adminSession: { user: { platformRole } } }),
        }),
      }) as unknown as ExecutionContext;
    expect(guard.canActivate(context("PLATFORM_ADMIN"))).toBe(true);
    for (const role of ["OPERATOR", "INSTITUTION_ADMIN", "ANALYST"])
      expect(() => guard.canActivate(context(role))).toThrow(ForbiddenException);
    for (const method of ["create", "update", "setStatus"] as const)
      expect(
        (
          Reflect.getMetadata(GUARDS_METADATA, PlatformPlansController.prototype[method]) as {
            name: string;
          }[]
        ).map((item) => item.name),
      ).toContain("AdminOriginGuard");
  });

  it("rechaza campos internos y precio inválido en el contrato de escritura", async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    const create = { ...body, code: "PRO" };
    await expect(
      pipe.transform({ ...create, active: true }, { type: "body", metatype: CreatePlanDto }),
    ).rejects.toThrow();
    await expect(
      pipe.transform({ ...body, planId: "otro" }, { type: "body", metatype: UpdatePlanDto }),
    ).rejects.toThrow();
    await expect(
      pipe.transform({ ...body, price: "-1" }, { type: "body", metatype: UpdatePlanDto }),
    ).rejects.toThrow();
  });

  it("rechaza una edición con revisión desactualizada sin escribir ni auditar", async () => {
    const updateMany = jest.fn();
    const recordPlanCatalogAction = jest.fn();
    const db = {
      client: {
        plan: {
          findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({ ...plan, revision: 2 }),
          updateMany,
        },
      },
      run: (work: () => Promise<unknown>) => work(),
    } as unknown as DatabaseUnitOfWork;
    const service = new PlatformPlansService(db, { recordPlanCatalogAction } as unknown as AuditWriter);
    await expect(service.update(plan.id, body, "admin-1")).rejects.toThrow(ConflictException);
    expect(updateMany).not.toHaveBeenCalled();
    expect(recordPlanCatalogAction).not.toHaveBeenCalled();
  });

  it("no cambia revisión ni auditoría al repetir el mismo guardado", async () => {
    const updateMany = jest.fn();
    const recordPlanCatalogAction = jest.fn();
    const db = {
      client: { plan: { findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue(plan), updateMany } },
      run: (work: () => Promise<unknown>) => work(),
    } as unknown as DatabaseUnitOfWork;
    const service = new PlatformPlansService(db, { recordPlanCatalogAction } as unknown as AuditWriter);
    const result = await service.update(
      plan.id,
      { ...body, price: "100.00", evaluationsPerMonth: 50 },
      "admin-1",
    );
    expect(result.changed).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
    expect(recordPlanCatalogAction).not.toHaveBeenCalled();
  });

  it("mantiene condiciones históricas y no ofrece un plan desactivado", () => {
    const historical = planTerms(plan as never);
    const current = {
      ...plan,
      price: new Prisma.Decimal("200.00"),
      evaluationsPerMonth: 100,
      revision: 2,
      active: false,
    };
    expect(contractedTerms(historical, current as never)).toEqual(historical);
    expect(contractedTerms(historical, current as never).price).toBe("100.00");
    expect(contractedTerms(historical, current as never).evaluationsPerMonth).toBe(50);
    expect(isOfferEligible(current as never)).toBe(false);
  });
});
