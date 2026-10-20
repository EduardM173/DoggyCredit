import { describe, expect, it } from "@jest/globals";
import { effectiveBreaker, ProviderHealthReadService } from "./provider-health-read.service.js";

const t0 = new Date("2026-10-20T10:00:00Z");
const at = (min: number) => new Date(t0.getTime() + min * 60_000);
const obs = (status: string, min: number) => ({ status, at: at(min) }) as never;
const episode = { startedAt: t0 };

describe("HU-23 T07 · effectiveBreaker (recuperación con evidencia)", () => {
  it("breaker local OPEN o HALF_OPEN manda", () => {
    expect(effectiveBreaker({ local: "OPEN", openEpisode: null, observations: [], minSamples: 3 })).toEqual({ state: "OPEN" });
    expect(effectiveBreaker({ local: "HALF_OPEN", openEpisode: episode, observations: [], minSamples: 3 })).toEqual({ state: "HALF_OPEN" });
  });
  it("sin episodio abierto se respeta el estado local", () => {
    expect(effectiveBreaker({ local: "CLOSED", openEpisode: null, observations: [], minSamples: 3 })).toEqual({ state: "CLOSED" });
    expect(effectiveBreaker({ local: null, openEpisode: null, observations: [], minSamples: 3 })).toBeNull();
  });
  it("episodio huérfano tras reinicio: sin evidencia sigue abierto", () => {
    expect(effectiveBreaker({ local: null, openEpisode: episode, observations: [], minSamples: 3 })).toEqual({ state: "OPEN" });
  });
  it("recupera solo con minSamples válidas y 0 fallos posteriores al inicio", () => {
    const good = [obs("SUCCESS", 1), obs("NO_DATA", 2), obs("SUCCESS", 3)];
    expect(effectiveBreaker({ local: "CLOSED", openEpisode: episode, observations: good, minSamples: 3 })).toEqual({ state: "CLOSED" });
    expect(effectiveBreaker({ local: "CLOSED", openEpisode: episode, observations: good.slice(0, 2), minSamples: 3 })).toEqual({ state: "OPEN" });
    expect(effectiveBreaker({ local: "CLOSED", openEpisode: episode, observations: [...good, obs("ERROR", 4)], minSamples: 3 })).toEqual({ state: "OPEN" });
  });
  it("las observaciones anteriores al episodio no cuentan", () => {
    const old = [obs("SUCCESS", -3), obs("SUCCESS", -2), obs("SUCCESS", -1)];
    expect(effectiveBreaker({ local: "CLOSED", openEpisode: episode, observations: old, minSamples: 3 })).toEqual({ state: "OPEN" });
  });
});

const resilient = { metrics: { snapshot: () => [] } };
const audit = { findOpenProviderEpisode: async () => null };

describe("HU-23 T07 · lectura", () => {
  it("fallo de monitoreo nunca se muestra como operativo", async () => {
    const db = { client: { integrationProvider: { findUnique: async () => { throw new Error("db caída"); } } } };
    const svc = new ProviderHealthReadService(db as never, audit as never, resilient as never);
    const list = await svc.list();
    expect(list.every((i) => i.health.state === "ERROR_MONITOREO")).toBe(true);
    const detail = await svc.detail("BUREAU_MOCK");
    expect(detail.advanced.reasonCode).toBe("MONITOR_ERROR");
    expect(detail.protection.label).toBe("Sin información");
  });

  it("señal vieja o ausente es 'sin señal', con afectados desconocidos (no cero)", async () => {
    const db = {
      client: {
        integrationProvider: { findUnique: async () => ({ id: "p1", globallyEnabled: true }) },
        evaluationSourceResult: { findMany: async () => [] },
        tenantIntegration: { count: async () => 1 },
        tenant: { findMany: async () => [] },
      },
    };
    const svc = new ProviderHealthReadService(db as never, audit as never, resilient as never);
    const detail = await svc.detail("BANK_MOCK");
    expect(detail.health.state).toBe("SIN_SENAL_RECIENTE");
    expect(detail.tenants.affected).toEqual({ known: false, count: null });
  });

  it("un proveedor inexistente da 404", () => {
    const svc = new ProviderHealthReadService({} as never, audit as never, resilient as never);
    expect(() => svc.detail("NO_EXISTE")).toThrow();
  });
});