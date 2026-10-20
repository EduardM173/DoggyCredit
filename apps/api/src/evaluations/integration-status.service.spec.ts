import { describe, expect, it } from "@jest/globals";
import { toStatusItem } from "./integration-status.service.js";

const base = { name: "Buró crediticio simulado", globallyEnabled: true };
const health = (state: string) => ({ state, lastSignalAt: null, confidence: "HIGH" }) as never;

describe("HU-23 T05 · estado de integraciones para la institución", () => {
  it("degradado se muestra como interrupción temporal", () => {
    expect(toStatusItem({ ...base, health: health("DEGRADADO_OBSERVADO") }).availability).toBe(
      "TEMPORARILY_UNAVAILABLE",
    );
  });
  it("operativo se muestra como disponible", () => {
    expect(toStatusItem({ ...base, health: health("OPERATIVO_OBSERVADO") }).availability).toBe("AVAILABLE");
  });
  it("sin señal y error de monitoreo son desconocido, nunca disponible", () => {
    expect(toStatusItem({ ...base, health: health("SIN_SENAL_RECIENTE") }).availability).toBe("UNKNOWN");
    expect(toStatusItem({ ...base, health: health("ERROR_MONITOREO") }).availability).toBe("UNKNOWN");
  });
  it("deshabilitado globalmente se avisa como no disponible", () => {
    expect(
      toStatusItem({ name: "X", globallyEnabled: false, health: health("OPERATIVO_OBSERVADO") }).availability,
    ).toBe("TEMPORARILY_UNAVAILABLE");
  });
  it("la respuesta no filtra datos internos", () => {
    const json = JSON.stringify(toStatusItem({ ...base, health: health("DEGRADADO_OBSERVADO") }));
    expect(json).not.toMatch(/breaker|OPEN|HALF_OPEN|episode|INSTANCIA_API|reasonCode|samples|failures/i);
    expect(Object.keys(toStatusItem({ ...base, health: health("DEGRADADO_OBSERVADO") })).sort()).toEqual([
      "availability",
      "message",
      "providerName",
    ]);
  });
});