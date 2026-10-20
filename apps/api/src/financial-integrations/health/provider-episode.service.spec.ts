import { ProviderEpisodeService, decideEpisodeAction } from "./provider-episode.service.js";

type Rec = {
  providerId: string;
  providerCode: string;
  action: "PROVIDER_DEGRADED" | "PROVIDER_RECOVERED";
  from: string;
  to: string;
  episodeId: string;
};

function setup(failWrites = false) {
  const providers: Record<string, string> = { BUREAU_MOCK: "p-bureau", BANK_MOCK: "p-bank" };
  const log: Rec[] = [];
  const audit = {
    async recordProviderHealthTransition(e: Rec) {
      if (failWrites) throw new Error("db down");
      log.push(e);
    },
    async findOpenProviderEpisode(providerId: string) {
      const last = [...log].reverse().find((r) => r.providerId === providerId);
      return last && last.action === "PROVIDER_DEGRADED"
        ? { episodeId: last.episodeId, startedAt: new Date() }
        : null;
    },
  };
  const database = {
    client: {
      integrationProvider: {
        async findUnique({ where }: { where: { code: string } }) {
          const id = providers[where.code];
          return id ? { id } : null;
        },
      },
    },
  };
  return { svc: new ProviderEpisodeService(audit as never, database as never), log };
}

describe("decideEpisodeAction", () => {
  it("CLOSED->OPEN sin episodio abierto abre uno", () => {
    expect(decideEpisodeAction({ from: "CLOSED", to: "OPEN", openEpisodeId: null }).kind).toBe("OPEN");
  });
  it("OPEN<->HALF_OPEN no hace nada", () => {
    expect(decideEpisodeAction({ from: "OPEN", to: "HALF_OPEN", openEpisodeId: "e1" }).kind).toBe("NONE");
    expect(decideEpisodeAction({ from: "HALF_OPEN", to: "OPEN", openEpisodeId: "e1" }).kind).toBe("NONE");
  });
});

describe("ProviderEpisodeService", () => {
  it("N aperturas con episodio abierto => UN solo PROVIDER_DEGRADED (CA-23.04/.16)", async () => {
    const { svc, log } = setup();
    for (let i = 0; i < 5; i++) await svc.handle("BUREAU_MOCK", "CLOSED", "OPEN");
    expect(log).toHaveLength(1);
    expect(log[0].action).toBe("PROVIDER_DEGRADED");
    expect(log[0].episodeId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("OPEN->HALF_OPEN y HALF_OPEN->OPEN no escriben nada", async () => {
    const { svc, log } = setup();
    await svc.handle("BUREAU_MOCK", "CLOSED", "OPEN");
    await svc.handle("BUREAU_MOCK", "OPEN", "HALF_OPEN");
    await svc.handle("BUREAU_MOCK", "HALF_OPEN", "OPEN");
    expect(log).toHaveLength(1);
  });

  it("HALF_OPEN->CLOSED registra PROVIDER_RECOVERED con el mismo episodeId (CA-23.08)", async () => {
    const { svc, log } = setup();
    await svc.handle("BUREAU_MOCK", "CLOSED", "OPEN");
    await svc.handle("BUREAU_MOCK", "OPEN", "HALF_OPEN");
    await svc.handle("BUREAU_MOCK", "HALF_OPEN", "CLOSED");
    expect(log.map((r) => r.action)).toEqual(["PROVIDER_DEGRADED", "PROVIDER_RECOVERED"]);
    expect(log[1].episodeId).toBe(log[0].episodeId);
  });

  it("recuperación sin episodio abierto no escribe", async () => {
    const { svc, log } = setup();
    await svc.handle("BUREAU_MOCK", "HALF_OPEN", "CLOSED");
    expect(log).toHaveLength(0);
  });

  it("un nuevo episodio tras recuperarse recibe otro episodeId", async () => {
    const { svc, log } = setup();
    await svc.handle("BUREAU_MOCK", "CLOSED", "OPEN");
    await svc.handle("BUREAU_MOCK", "HALF_OPEN", "CLOSED");
    await svc.handle("BUREAU_MOCK", "CLOSED", "OPEN");
    expect(log).toHaveLength(3);
    expect(log[2].episodeId).not.toBe(log[0].episodeId);
  });

  it("Bank no se ve afectado por la caída de Buró (episodios por proveedor)", async () => {
    const { svc, log } = setup();
    await svc.handle("BUREAU_MOCK", "CLOSED", "OPEN");
    expect(log.every((r) => r.providerCode === "BUREAU_MOCK")).toBe(true);
  });

  it("proveedor desconocido no escribe", async () => {
    const { svc, log } = setup();
    await svc.handle("OTRO", "CLOSED", "OPEN");
    expect(log).toHaveLength(0);
  });

  it("si la auditoría falla, onBreakerChange no lanza", async () => {
    const { svc } = setup(true);
    expect(() => svc.onBreakerChange("BUREAU_MOCK", "CLOSED", "OPEN")).not.toThrow();
    await new Promise((r) => setTimeout(r, 10));
  });

  it("metadata del evento solo lleva campos permitidos", async () => {
    const { svc, log } = setup();
    await svc.handle("BUREAU_MOCK", "CLOSED", "OPEN");
    expect(Object.keys(log[0]).sort()).toEqual(
      ["action", "episodeId", "from", "providerCode", "providerId", "to"].sort(),
    );
  });
});
