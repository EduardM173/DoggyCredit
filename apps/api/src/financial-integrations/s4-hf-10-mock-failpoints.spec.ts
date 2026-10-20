/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, beforeAll, beforeEach, jest } from "@jest/globals";
import { BankMockSourceService } from "./bank-mock-source.service.js";
import { BureauMockSourceService } from "./bureau-mock-source.service.js";
import { ResilientSources } from "./public.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";

type MockFn = jest.Mock<any>;

describe("S4-HF-10 — Ejecutar fallos controlados de mocks sin SQL", () => {
  let bankService: BankMockSourceService;
  let bureauService: BureauMockSourceService;
  let resilient: ResilientSources;
  let mockDb: {
    client: {
      integrationProvider: { findUnique: MockFn; update: MockFn };
      tenantIntegration: { findUnique: MockFn; update: MockFn; upsert: MockFn };
    };
  };

  beforeAll(() => {
    process.env.PROVIDER_BACKOFF_BASE_MS = "1";
    process.env.PROVIDER_BACKOFF_MAX_MS = "2";
  });

  beforeEach(() => {
    mockDb = {
      client: {
        integrationProvider: {
          findUnique: jest.fn().mockImplementation(({ where }: any) => {
            if (where.code === "BANK_MOCK") {
              return Promise.resolve({ id: "prov-bank", code: "BANK_MOCK", status: "ACTIVE", globallyEnabled: true });
            }
            if (where.code === "BUREAU_MOCK") {
              return Promise.resolve({ id: "prov-bureau", code: "BUREAU_MOCK", status: "ACTIVE", globallyEnabled: true });
            }
            return Promise.resolve(null);
          }) as MockFn,
          update: jest.fn(),
        },
        tenantIntegration: {
          findUnique: jest.fn<any>().mockResolvedValue({ id: "ti-1", enabled: true, status: "ACTIVE" }),
          update: jest.fn(),
          upsert: jest.fn(),
        },
      },
    };

    bankService = new BankMockSourceService(mockDb as unknown as DatabaseUnitOfWork);
    bureauService = new BureauMockSourceService(mockDb as unknown as DatabaseUnitOfWork);
    resilient = new ResilientSources(bankService, bureauService);
  });

  it("Escenario 1: simula UNAVAILABLE y NO_DATA mediante fixtures deterministas sin SQL UPDATE", async () => {
    // Document ending in 999 triggers UNAVAILABLE deterministically
    const bankUnavailable = await bankService.query("tenant-1", "1234999", "PERSON");
    expect(bankUnavailable.status).toBe("UNAVAILABLE");
    expect((bankUnavailable as any).errorCode).toBe("BANK_UNAVAILABLE");

    const bureauUnavailable = await bureauService.query("tenant-1", "9876999");
    expect(bureauUnavailable.status).toBe("UNAVAILABLE");
    expect((bureauUnavailable as any).errorCode).toBe("BUREAU_UNAVAILABLE");

    // Document ending in 000 triggers NO_DATA deterministically
    const bankNoData = await bankService.query("tenant-1", "1234000", "PERSON");
    expect(bankNoData.status).toBe("NO_DATA");

    const bureauNoData = await bureauService.query("tenant-1", "9876000");
    expect(bureauNoData.status).toBe("NO_DATA");

    // Standard document succeeds deterministically
    const bankOk = await bankService.query("tenant-1", "1234567", "PERSON");
    expect(bankOk.status).toBe("SUCCESS");

    const bureauOk = await bureauService.query("tenant-1", "1234567");
    expect(bureauOk.status).toBe("SUCCESS");

    // Probar que NINGUNA sentencia SQL UPDATE fue ejecutada sobre integrationProvider o tenantIntegration
    expect(mockDb.client.integrationProvider.update).not.toHaveBeenCalled();
    expect(mockDb.client.tenantIntegration.update).not.toHaveBeenCalled();
  });

  it("Escenario 2: demuestra apertura de Circuit Breaker bajo fallos repetidos sin intervención SQL", async () => {
    // 2 queries con 999 generan 4 intentos cada una, alcanzando el umbral de fallos consecutivos
    await resilient.queryBureau("prov-bureau", "tenant-1", "1111999");
    await resilient.queryBureau("prov-bureau", "tenant-1", "2222999");

    // Breaker debe estar en estado OPEN
    const snapshot = resilient.metrics.snapshot().find((s) => s.providerCode === "BUREAU_MOCK");
    expect(snapshot?.breaker).toBe("OPEN");

    // Siguiente llamada falla inmediatamente por CIRCUIT_OPEN sin tocar la red ni BD
    const shortCircuited = await resilient.queryBureau("prov-bureau", "tenant-1", "3333999");
    expect(shortCircuited.status).toBe("UNAVAILABLE");
    expect((shortCircuited as any).errorCode).toBe("CIRCUIT_OPEN");

    // Cero operaciones SQL de escritura
    expect(mockDb.client.integrationProvider.update).not.toHaveBeenCalled();
  });

  it("Escenario 3: NO_DATA no abre el breaker ni requiere bypass SQL", async () => {
    // Llamadas con 000 no se consideran fallos técnicos del proveedor
    for (let i = 0; i < 6; i++) {
      const res = await resilient.queryBank("prov-bank", "tenant-1", `555000`, "PERSON");
      expect(res.status).toBe("NO_DATA");
    }

    const snapshot = resilient.metrics.snapshot().find((s) => s.providerCode === "BANK_MOCK");
    expect(snapshot?.breaker).toBe("CLOSED");
    expect(mockDb.client.integrationProvider.update).not.toHaveBeenCalled();
  });
});
