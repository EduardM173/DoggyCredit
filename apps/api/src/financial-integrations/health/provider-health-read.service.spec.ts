import { ProviderHealthReadService, effectiveBreaker } from "./provider-health-read.service.js";

const NOW = new Date("2026-10-19T12:00:00Z");
const ago = (s: number) => new Date(NOW.getTime() - s * 1000);
type Status = "SUCCESS" | "NO_DATA" | "UNAVAILABLE" | "ERROR";
const rows = (status: Status, n: number, tenantId = "t1") =>
  Array.from({ length: n }, (_, i) => ({
    status,
    requestedAt: ago(60 + i),
    respondedAt: ago(60 + i),
    tenantId,
    // Campos sensibles que el servicio NUNCA debe devolver aunque la base los tuviera:
    documentNumber: "7812456999",
    normalizedPayload: { token: "SECRETO-TOKEN", url: "https://proveedor.interno/api" },
  }));

class TestService extends ProviderHealthReadService {
  protected override now() {
    return NOW;
  }
}

function setup(opts: {
  data?: Record<string, ReturnType<typeof rows>>;
  breakers?: Record<string, "CLOSED" | "OPEN" | "HALF_OPEN">;
  openEpisode?: { episodeId: string; startedAt: Date } | null;
  failMonitoring?: boolean;
}) {
  const ids: Record<string, string> = { BANK_MOCK: "p-bank", BUREAU_MOCK: "p-bureau" };
  const byId: Record<string, string> = { "p-bank": "BANK_MOCK", "p-bureau": "BUREAU_MOCK" };
  let reads = 0;
  // Fake SOLO con métodos de lectura: cualquier intento de escribir lanzaría TypeError.
  const db = {
    client: {
      integrationProvider: {
        async findUnique({ where }: { where: { code: string } }) {
          reads++;
          return { id: ids[where.code], globallyEnabled: true };
        },
      },
      evaluationSourceResult: {
        async findMany({ where }: { where: { providerId: string } }) {
          reads++;
          if (opts.failMonitoring) throw new Error("db down");
          return opts.data?.[byId[where.providerId]] ?? [];
        },
      },
      tenantIntegration: { async count() { return 2; } },
      tenant: { async findMany() { return [{ legalName: "Banco del Sol Demo" }]; } },
    },
  };
  const audit = { async findOpenProviderEpisode() { return opts.openEpisode ?? null; } };
  const resilient = {
    metrics: {
      snapshot: () =>
        Object.entries(opts.breakers ?? {}).map(([providerCode, breaker]) => ({ providerCode, breaker })),
    },
  };
  const svc = new TestService(db as never, audit as never, resilient as never);
  return { svc, reads: () => reads };
}

describe("ProviderHealthReadService", () => {
  it("Buró caído se distingue de Bank operativo (PA-23 escenario 1)", async () => {
    const { svc } = setup({
      data: { BUREAU_MOCK: rows("UNAVAILABLE", 12), BANK_MOCK: rows("SUCCESS", 12) },
      breakers: { BUREAU_MOCK: "OPEN" },
    });
    const list = await svc.list();
    const bureau = list.find((p) => p.code === "BUREAU_MOCK")!;
    const bank = list.find((p) => p.code === "BANK_MOCK")!;
    expect(bureau.health.state).toBe("DEGRADADO_OBSERVADO");
    expect(bank.health.state).toBe("OPERATIVO_OBSERVADO");
    const detail = await svc.detail("BUREAU_MOCK");
    expect(detail.health.nextStep).toContain("protección temporal");
    expect(detail.protection.label).toBe("Protección temporal activa");
    expect(detail.affectedTenants).toEqual([{ name: "Banco del Sol Demo" }]);
  });

  it("solo NO_DATA no genera incidente (PA-23 escenario 2)", async () => {
    const { svc } = setup({ data: { BUREAU_MOCK: rows("NO_DATA", 15) }, breakers: { BUREAU_MOCK: "CLOSED" } });
    const bureau = (await svc.list()).find((p) => p.code === "BUREAU_MOCK")!;
    expect(bureau.health.state).toBe("OPERATIVO_OBSERVADO");
    expect(bureau.tenants.affected).toEqual({ known: true, count: 0 });
  });

  it("sin señal => SIN_SENAL_RECIENTE y afectados DESCONOCIDO, no cero (CA-23.05)", async () => {
    const { svc } = setup({});
    const bank = (await svc.list()).find((p) => p.code === "BANK_MOCK")!;
    expect(bank.health.state).toBe("SIN_SENAL_RECIENTE");
    expect(bank.tenants.affected).toEqual({ known: false, count: null });
  });

  it("fallo de lectura => ERROR_MONITOREO, nunca operativo", async () => {
    const { svc } = setup({ failMonitoring: true });
    const list = await svc.list();
    expect(list.every((p) => p.health.state === "ERROR_MONITOREO")).toBe(true);
    const d = await svc.detail("BUREAU_MOCK");
    expect(d.health.explanation).toContain("No pudimos leer");
  });

  it("episodio abierto sin evidencia de recuperación sigue degradado", async () => {
    const { svc } = setup({
      data: { BUREAU_MOCK: rows("SUCCESS", 3) },
      openEpisode: { episodeId: "e1", startedAt: ago(500) },
    });
    const d = await svc.detail("BUREAU_MOCK");
    expect(d.health.state).toBe("DEGRADADO_OBSERVADO");
    expect(d.episode?.episodeId).toBe("e1");
  });

  it("recuperación solo con evidencia: >= minSamples éxitos tras el episodio y 0 fallos", () => {
    const ok = Array.from({ length: 10 }, (_, i) => ({ status: "SUCCESS" as const, at: ago(100 + i) }));
    const ep = { startedAt: ago(500) };
    expect(effectiveBreaker({ local: "CLOSED", openEpisode: ep, observations: ok, minSamples: 10 })?.state).toBe("CLOSED");
    expect(effectiveBreaker({ local: "CLOSED", openEpisode: ep, observations: ok.slice(0, 3), minSamples: 10 })?.state).toBe("OPEN");
    expect(
      effectiveBreaker({ local: "CLOSED", openEpisode: ep, observations: [...ok, { status: "ERROR", at: ago(50) }], minSamples: 10 })?.state,
    ).toBe("OPEN");
    expect(effectiveBreaker({ local: "HALF_OPEN", openEpisode: ep, observations: ok, minSamples: 10 })?.state).toBe("HALF_OPEN");
  });

  it("un GET repetido no cambia el resultado ni escribe (CA-23.08)", async () => {
    const { svc } = setup({ data: { BUREAU_MOCK: rows("UNAVAILABLE", 12) }, breakers: { BUREAU_MOCK: "OPEN" } });
    const a = JSON.stringify(await svc.list());
    const b = JSON.stringify(await svc.list());
    expect(a).toBe(b);
  });

  it("la respuesta no contiene CI/NIT, tokens ni URLs (escaneo profundo)", async () => {
    const { svc } = setup({
      data: { BUREAU_MOCK: rows("UNAVAILABLE", 12), BANK_MOCK: rows("SUCCESS", 12) },
      breakers: { BUREAU_MOCK: "OPEN" },
    });
    const dump = JSON.stringify([await svc.list(), await svc.detail("BUREAU_MOCK"), await svc.detail("BANK_MOCK")]);
    for (const sentinel of ["7812456999", "SECRETO-TOKEN", "https://", "proveedor.interno"])
      expect(dump).not.toContain(sentinel);
  });

  it("código de proveedor desconocido => 404", () => {
    const { svc } = setup({});
    expect(() => svc.detail("OTRO")).toThrow();
  });
});
