import { jest } from "@jest/globals";
import { ServiceUnavailableException } from "@nestjs/common";
import { BankMockSourceService } from "./bank-mock-source.service.js";
import { BureauMockSourceService } from "./bureau-mock-source.service.js";
import { SIMULATION_SCENARIOS, providerAcceptsQueries } from "./public.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockFn = jest.Mock<any>;

function makeDb() {
  return {
    client: {
      integrationProvider: { findUnique: jest.fn<any>() as MockFn },
      tenantIntegration: { findUnique: jest.fn<any>() as MockFn, upsert: jest.fn<any>() as MockFn },
    },
  };
}

describe("HU-30 habilitación global en las fuentes simuladas", () => {
  describe("providerAcceptsQueries", () => {
    it("exige habilitación global y salud ACTIVE; ausencia del flag cuenta como habilitado", () => {
      expect(providerAcceptsQueries({ status: "ACTIVE", globallyEnabled: true })).toBe(true);
      expect(providerAcceptsQueries({ status: "ACTIVE" })).toBe(true);
      expect(providerAcceptsQueries({ status: "ACTIVE", globallyEnabled: false })).toBe(false);
      expect(providerAcceptsQueries({ status: "DEGRADED", globallyEnabled: true })).toBe(false);
      expect(providerAcceptsQueries({ status: "INACTIVE", globallyEnabled: true })).toBe(false);
    });
  });

  describe.each([
    [
      "BANK_MOCK",
      () => makeDb(),
      (db: ReturnType<typeof makeDb>) => new BankMockSourceService(db as unknown as DatabaseUnitOfWork),
    ],
    [
      "BUREAU_MOCK",
      () => makeDb(),
      (db: ReturnType<typeof makeDb>) => new BureauMockSourceService(db as unknown as DatabaseUnitOfWork),
    ],
  ] as const)("%s", (_code, create, build) => {
    let db: ReturnType<typeof makeDb>;
    let source: BankMockSourceService | BureauMockSourceService;
    beforeEach(() => {
      db = create();
      source = build(db);
    });

    it("deshabilitado globalmente: no disponible ni habilitado para nuevas evaluaciones, aunque el tenant lo tenga activo", async () => {
      db.client.integrationProvider.findUnique.mockResolvedValue({
        id: "p1",
        status: "ACTIVE",
        globallyEnabled: false,
      });
      db.client.tenantIntegration.findUnique.mockResolvedValue({ enabled: true, status: "ACTIVE" });
      const status = await source.status("tenant-x");
      expect(status.available).toBe(false);
      expect(status.enabled).toBe(false);
      expect(status.globallyEnabled).toBe(false);
      // La salud del proveedor no se reescribe: sigue siendo un hecho aparte.
      expect(status.healthStatus).toBe("ACTIVE");
    });

    it("la habilitación del tenant no se modifica al deshabilitar globalmente (se conserva al rehabilitar)", async () => {
      db.client.integrationProvider.findUnique.mockResolvedValue({
        id: "p1",
        status: "ACTIVE",
        globallyEnabled: false,
      });
      db.client.tenantIntegration.findUnique.mockResolvedValue({ enabled: true, status: "ACTIVE" });
      await source.status("tenant-x");
      expect(db.client.tenantIntegration.upsert).not.toHaveBeenCalled();

      db.client.integrationProvider.findUnique.mockResolvedValue({
        id: "p1",
        status: "ACTIVE",
        globallyEnabled: true,
      });
      const back = await source.status("tenant-x");
      expect(back.enabled).toBe(true);
      expect(back.globallyEnabled).toBe(true);
    });

    it("rechaza consultas nuevas cuando está deshabilitado globalmente", async () => {
      db.client.integrationProvider.findUnique.mockResolvedValue({
        id: "p1",
        status: "ACTIVE",
        globallyEnabled: false,
      });
      await expect(source.query("tenant-x", "7812456", "PERSON")).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(db.client.tenantIntegration.findUnique).not.toHaveBeenCalled();
    });

    it("no permite que una institución lo habilite mientras la plataforma lo tiene deshabilitado", async () => {
      db.client.integrationProvider.findUnique.mockResolvedValue({
        id: "p1",
        status: "ACTIVE",
        globallyEnabled: false,
      });
      await expect(source.enable("tenant-x")).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(db.client.tenantIntegration.upsert).not.toHaveBeenCalled();
    });

    it("sin el flag (registro previo a HU-30) se comporta como habilitado", async () => {
      db.client.integrationProvider.findUnique.mockResolvedValue({ id: "p1", status: "ACTIVE" });
      db.client.tenantIntegration.findUnique.mockResolvedValue({ enabled: true, status: "ACTIVE" });
      const status = await source.status("tenant-x");
      expect(status.available).toBe(true);
      expect(status.enabled).toBe(true);
    });
  });

  describe("CA-30.06 escenarios predecibles sin editar registros", () => {
    const activeProvider = { id: "p1", status: "ACTIVE", globallyEnabled: true };
    const enabledTenant = { enabled: true, status: "ACTIVE" };
    const endings: Record<string, string> = { UNAVAILABLE: "1234999", ERROR: "1234500", NO_DATA: "1234000" };

    it.each(["UNAVAILABLE", "ERROR", "NO_DATA"])(
      "Bank Mock devuelve %s según la terminación documentada",
      async (status) => {
        const db = makeDb();
        db.client.integrationProvider.findUnique.mockResolvedValue(activeProvider);
        db.client.tenantIntegration.findUnique.mockResolvedValue(enabledTenant);
        const bank = new BankMockSourceService(db as unknown as DatabaseUnitOfWork);
        const result = await bank.query("tenant-x", endings[status]!, "PERSON");
        expect(result.status).toBe(status);
      },
    );

    it.each(["UNAVAILABLE", "ERROR", "NO_DATA"])(
      "Buró Mock devuelve %s según la terminación documentada",
      async (status) => {
        const db = makeDb();
        db.client.integrationProvider.findUnique.mockResolvedValue(activeProvider);
        db.client.tenantIntegration.findUnique.mockResolvedValue(enabledTenant);
        const bureau = new BureauMockSourceService(db as unknown as DatabaseUnitOfWork);
        const result = await bureau.query("tenant-x", endings[status]!);
        expect(result.status).toBe(status);
      },
    );

    it("un documento común devuelve SUCCESS en ambos mocks", async () => {
      const db = makeDb();
      db.client.integrationProvider.findUnique.mockResolvedValue(activeProvider);
      db.client.tenantIntegration.findUnique.mockResolvedValue(enabledTenant);
      const bank = new BankMockSourceService(db as unknown as DatabaseUnitOfWork);
      const bureau = new BureauMockSourceService(db as unknown as DatabaseUnitOfWork);
      expect((await bank.query("tenant-x", "7812456", "PERSON")).status).toBe("SUCCESS");
      expect((await bureau.query("tenant-x", "7812456")).status).toBe("SUCCESS");
    });

    it("la lista documentada coincide con lo que los mocks hacen", () => {
      expect(SIMULATION_SCENARIOS.map((s) => [s.status, s.documentEnding])).toEqual([
        ["UNAVAILABLE", "999"],
        ["ERROR", "500"],
        ["NO_DATA", "000"],
        ["SUCCESS", "cualquier otro"],
      ]);
    });
  });
});
