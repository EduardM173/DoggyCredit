import { jest } from "@jest/globals";
import { ForbiddenException, ValidationPipe, type ExecutionContext } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { OperatorGuard, PlatformAdminGuard, AdminAuthGuard } from "./identity-tenants/public.js";
import { PlatformProvidersController, SetProviderGlobalStatusDto } from "./platform-providers.controller.js";
import type { ProviderAdministrationService } from "./financial-integrations/public.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const context = (role: string | null | undefined) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ adminSession: role === undefined ? undefined : { user: { platformRole: role } } }),
    }),
  }) as unknown as ExecutionContext;

describe("HU-30 acceso restringido a PLATFORM_ADMIN", () => {
  it("PlatformAdminGuard admite PLATFORM_ADMIN y rechaza OPERATOR, sin rol y sin sesión", () => {
    const guard = new PlatformAdminGuard();
    expect(guard.canActivate(context("PLATFORM_ADMIN"))).toBe(true);
    for (const role of ["OPERATOR", null, undefined])
      expect(() => guard.canActivate(context(role))).toThrow(ForbiddenException);
  });

  it("OperatorGuard sigue sin admitir a PLATFORM_ADMIN: los permisos no se mezclan", () => {
    expect(() => new OperatorGuard().canActivate(context("PLATFORM_ADMIN"))).toThrow(ForbiddenException);
  });

  it("el controlador exige sesión + PlatformAdminGuard y no usa OperatorGuard", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, PlatformProvidersController) as unknown[];
    expect(guards).toEqual([AdminAuthGuard, PlatformAdminGuard]);
  });

  it("el cambio de estado exige además origen y cabecera de administración", () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      PlatformProvidersController.prototype.setGlobalStatus,
    ) as { name: string }[];
    expect(guards.map((g) => g.name)).toContain("AdminOriginGuard");
  });

  it("delega al servicio con el actor autenticado, nunca con un id enviado por el cliente", async () => {
    const providers = {
      setGlobalEnabled: jest.fn<any>().mockResolvedValue({ changed: true }),
      list: jest.fn<any>().mockResolvedValue([]),
      detail: jest.fn<any>().mockResolvedValue({}),
    };
    const controller = new PlatformProvidersController(providers as unknown as ProviderAdministrationService);
    await controller.setGlobalStatus("BANK_MOCK", { enabled: false, reason: "Mantenimiento" }, {
      adminSession: { user: { id: "admin-1" } },
    } as any);
    expect(providers.setGlobalEnabled).toHaveBeenCalledWith("BANK_MOCK", false, "admin-1", "Mantenimiento");
  });
});

describe("HU-30 CA-30.04 solo campos aprobados", () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const meta = { type: "body" as const, metatype: SetProviderGlobalStatusDto };

  it("acepta enabled y reason", async () => {
    await expect(pipe.transform({ enabled: false, reason: "Mantenimiento" }, meta)).resolves.toMatchObject({
      enabled: false,
    });
  });

  it.each([
    { enabled: true, url: "https://externo.test" },
    { enabled: true, apiKey: "no-debe-aceptarse" },
    { enabled: true, timeoutMs: 100 },
    { enabled: true, secret: "x" },
  ])("rechaza campos técnicos o secretos: %j", async (body) => {
    await expect(pipe.transform(body, meta)).rejects.toThrow();
  });

  it("rechaza enabled no booleano o ausente y reason demasiado largo", async () => {
    await expect(pipe.transform({ enabled: "false" }, meta)).rejects.toThrow();
    await expect(pipe.transform({}, meta)).rejects.toThrow();
    await expect(pipe.transform({ enabled: true, reason: "x".repeat(201) }, meta)).rejects.toThrow();
  });
});
