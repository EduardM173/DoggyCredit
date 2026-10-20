import { describe, expect, it } from "@jest/globals";
import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { InternalStaffGuard, OperatorGuard, PlatformAdminGuard } from "./identity-tenants/public.js";
import { PlatformIntegrationsController } from "./platform-integrations.controller.js";

const context = (role: string | null | undefined) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ adminSession: role === undefined ? undefined : { user: { platformRole: role } } }),
    }),
  }) as unknown as ExecutionContext;

describe("HU-23 T07 · permisos de integraciones", () => {
  it("InternalStaffGuard admite OPERATOR y PLATFORM_ADMIN y rechaza el resto con 403", () => {
    const guard = new InternalStaffGuard();
    expect(guard.canActivate(context("OPERATOR"))).toBe(true);
    expect(guard.canActivate(context("PLATFORM_ADMIN"))).toBe(true);
    for (const role of ["ANALYST", "INSTITUTION_ADMIN", null, undefined])
      expect(() => guard.canActivate(context(role))).toThrow(ForbiddenException);
  });
  it("el controlador usa InternalStaffGuard y no los guards de un solo rol", () => {
    const guards = (Reflect.getMetadata(GUARDS_METADATA, PlatformIntegrationsController) as { name: string }[]).map((g) => g.name);
    expect(guards).toContain("InternalStaffGuard");
    expect(guards).not.toContain(OperatorGuard.name);
    expect(guards).not.toContain(PlatformAdminGuard.name);
  });
  it("todas las rutas del controlador son GET (ninguna escribe)", () => {
    const proto = PlatformIntegrationsController.prototype as unknown as Record<string, unknown>;
    const handlers = Object.getOwnPropertyNames(proto).filter((n) => n !== "constructor" && typeof proto[n] === "function");
    expect(handlers.length).toBeGreaterThan(0);
    for (const name of handlers) expect(Reflect.getMetadata("method", proto[name] as object)).toBe(0);
  });
});