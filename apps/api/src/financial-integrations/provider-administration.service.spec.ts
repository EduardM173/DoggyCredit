import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import { NotFoundException } from "@nestjs/common";
import { ProviderAdministrationService } from "./provider-administration.service.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import type { AuditWriter } from "../audit/public.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockFn = jest.Mock<any>;

const providerRow = (over: Record<string, unknown> = {}) => ({
  id: "prov-1",
  status: "ACTIVE",
  globallyEnabled: true,
  globalChangedAt: null,
  ...over,
});

describe("HU-30 ProviderAdministrationService", () => {
  let client: {
    integrationProvider: { findUnique: MockFn; updateMany: MockFn };
    tenantIntegration: { count: MockFn };
    evaluation: { updateMany: MockFn; update: MockFn };
    evaluationSourceResult: { updateMany: MockFn; update: MockFn; deleteMany: MockFn };
    auditLog: { create: MockFn };
  };
  let audit: { recordProviderAdministration: MockFn };
  let service: ProviderAdministrationService;
  const build = (nodeEnv = "test") => {
    const db = { client, run: async <T>(work: () => Promise<T>) => work() } as unknown as DatabaseUnitOfWork;
    return new ProviderAdministrationService(
      db,
      audit as unknown as AuditWriter,
      new ConfigService({ NODE_ENV: nodeEnv }),
    );
  };

  beforeEach(() => {
    client = {
      integrationProvider: { findUnique: jest.fn<any>(), updateMany: jest.fn<any>() },
      tenantIntegration: { count: jest.fn<any>().mockResolvedValue(2) },
      evaluation: { updateMany: jest.fn<any>(), update: jest.fn<any>() },
      evaluationSourceResult: {
        updateMany: jest.fn<any>(),
        update: jest.fn<any>(),
        deleteMany: jest.fn<any>(),
      },
      auditLog: { create: jest.fn<any>() },
    };
    audit = { recordProviderAdministration: jest.fn<any>().mockResolvedValue(undefined) };
    service = build();
  });

  describe("CA-30.01 catálogo global sin IDs manuales", () => {
    it("lista Bank Mock y Buró Mock con nombre, tipo y cobertura real por tipo de solicitante", async () => {
      client.integrationProvider.findUnique.mockResolvedValue(providerRow());
      const list = await service.list();
      expect(list.map((p) => p.code)).toEqual(["BANK_MOCK", "BUREAU_MOCK"]);
      const bank = list.find((p) => p.code === "BANK_MOCK")!;
      const bureau = list.find((p) => p.code === "BUREAU_MOCK")!;
      expect(bank.coverage.subjectTypes).toEqual(["PERSON", "COMPANY"]);
      expect(bureau.coverage.subjectTypes).toEqual(["PERSON"]);
      expect(bank.kind).toBe("BANK");
      expect(bureau.kind).toBe("CREDIT_BUREAU");
    });

    it("marca como no registrado un proveedor ausente en BD sin inventarlo", async () => {
      client.integrationProvider.findUnique.mockResolvedValue(null);
      const view = await service.detail("BUREAU_MOCK");
      expect(view.registered).toBe(false);
      expect(view.acceptsNewQueries).toBe(false);
      expect(client.tenantIntegration.count).not.toHaveBeenCalled();
    });

    it("rechaza un código fuera del catálogo", async () => {
      await expect(service.detail("OTRO_PROVEEDOR")).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.setGlobalEnabled("OTRO", false, "admin-1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe("CA-30.05 tres hechos distintos", () => {
    it("separa habilitación global, salud observada y habilitación por instituciones", async () => {
      client.integrationProvider.findUnique.mockResolvedValue(
        providerRow({ status: "DEGRADED", globallyEnabled: true }),
      );
      const view = await service.detail("BANK_MOCK");
      expect(view.global.enabled).toBe(true);
      expect(view.health.status).toBe("DEGRADED");
      expect(view.tenants.enabled).toBe(2);
      // Salud degradada no equivale a deshabilitación global (ni al revés).
      expect(view.acceptsNewQueries).toBe(false);
    });

    it("global deshabilitado con salud ACTIVE sigue sin aceptar consultas y no cambia la salud", async () => {
      client.integrationProvider.findUnique.mockResolvedValue(
        providerRow({
          status: "ACTIVE",
          globallyEnabled: false,
          globalChangedAt: new Date("2026-10-18T10:00:00Z"),
        }),
      );
      const view = await service.detail("BANK_MOCK");
      expect(view.global).toEqual({ enabled: false, changedAt: "2026-10-18T10:00:00.000Z" });
      expect(view.health.status).toBe("ACTIVE");
      expect(view.acceptsNewQueries).toBe(false);
    });
  });

  describe("CA-30.02 / CA-30.03 / CA-30.07 deshabilitar globalmente", () => {
    it("actualiza solo el proveedor y registra auditoría una vez, sin tocar evaluaciones históricas", async () => {
      client.integrationProvider.findUnique
        .mockResolvedValueOnce({ id: "prov-1" })
        .mockResolvedValue(providerRow({ globallyEnabled: false }));
      client.integrationProvider.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.setGlobalEnabled("BANK_MOCK", false, "admin-1", "  Mantenimiento  ");

      expect(result.changed).toBe(true);
      expect(result.provider.global.enabled).toBe(false);
      expect(client.integrationProvider.updateMany).toHaveBeenCalledWith({
        where: { code: "BANK_MOCK", globallyEnabled: true },
        data: { globallyEnabled: false, globalChangedAt: expect.any(Date) },
      });
      expect(audit.recordProviderAdministration).toHaveBeenCalledTimes(1);
      expect(audit.recordProviderAdministration).toHaveBeenCalledWith({
        actorUserId: "admin-1",
        providerId: "prov-1",
        providerCode: "BANK_MOCK",
        action: "PROVIDER_GLOBALLY_DISABLED",
        previousEnabled: true,
        currentEnabled: false,
        reason: "Mantenimiento",
      });
      // Históricos intactos: ninguna escritura sobre evaluaciones ni resultados por fuente.
      expect(client.evaluation.updateMany).not.toHaveBeenCalled();
      expect(client.evaluation.update).not.toHaveBeenCalled();
      expect(client.evaluationSourceResult.updateMany).not.toHaveBeenCalled();
      expect(client.evaluationSourceResult.update).not.toHaveBeenCalled();
      expect(client.evaluationSourceResult.deleteMany).not.toHaveBeenCalled();
    });

    it("es idempotente: repetir el mismo estado no cambia nada ni audita", async () => {
      client.integrationProvider.findUnique.mockResolvedValue(providerRow({ globallyEnabled: false }));
      client.integrationProvider.updateMany.mockResolvedValue({ count: 0 });
      const result = await service.setGlobalEnabled("BANK_MOCK", false, "admin-1");
      expect(result.changed).toBe(false);
      expect(audit.recordProviderAdministration).not.toHaveBeenCalled();
    });

    it("rehabilitar audita PROVIDER_GLOBALLY_ENABLED", async () => {
      client.integrationProvider.findUnique.mockResolvedValue(providerRow());
      client.integrationProvider.updateMany.mockResolvedValue({ count: 1 });
      await service.setGlobalEnabled("BUREAU_MOCK", true, "admin-1");
      expect(client.integrationProvider.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { code: "BUREAU_MOCK", globallyEnabled: false } }),
      );
      expect(audit.recordProviderAdministration).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "PROVIDER_GLOBALLY_ENABLED",
          previousEnabled: false,
          currentEnabled: true,
          reason: undefined,
        }),
      );
    });

    it("no audita si el proveedor no está registrado", async () => {
      client.integrationProvider.findUnique.mockResolvedValue(null);
      await expect(service.setGlobalEnabled("BUREAU_MOCK", false, "admin-1")).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(client.integrationProvider.updateMany).not.toHaveBeenCalled();
      expect(audit.recordProviderAdministration).not.toHaveBeenCalled();
    });
  });

  describe("CA-30.04 sin secretos ni datos de solicitantes", () => {
    it("la vista solo expone campos aprobados", async () => {
      client.integrationProvider.findUnique.mockResolvedValue(providerRow());
      const view = await service.detail("BANK_MOCK");
      const serialized = JSON.stringify(view).toLowerCase();
      for (const forbidden of [
        "secret",
        "apikey",
        "api_key",
        "token",
        "password",
        "url",
        "timeout",
        "credential",
      ])
        expect(serialized).not.toContain(forbidden);
      expect(Object.keys(view).sort()).toEqual(
        [
          "acceptsNewQueries",
          "code",
          "coverage",
          "description",
          "global",
          "health",
          "kind",
          "name",
          "registered",
          "simulationScenarios",
          "tenants",
        ].sort(),
      );
    });

    it("los agregados por institución son solo conteos", async () => {
      client.integrationProvider.findUnique.mockResolvedValue(providerRow());
      const view = await service.detail("BANK_MOCK");
      expect(view.tenants).toEqual({ enabled: 2 });
    });
  });

  describe("CA-30.06 escenarios simulados", () => {
    it("lista los escenarios deterministas en pruebas y desarrollo", async () => {
      client.integrationProvider.findUnique.mockResolvedValue(providerRow());
      const view = await service.detail("BANK_MOCK");
      expect(view.simulationScenarios?.map((s) => s.status)).toEqual([
        "UNAVAILABLE",
        "ERROR",
        "NO_DATA",
        "SUCCESS",
      ]);
    });

    it("no los expone en producción ni en el listado", async () => {
      client.integrationProvider.findUnique.mockResolvedValue(providerRow());
      const prod = build("production");
      expect((await prod.detail("BANK_MOCK")).simulationScenarios).toBeUndefined();
      const list = await service.list();
      expect(list.every((p) => p.simulationScenarios === undefined)).toBe(true);
    });
  });
});
