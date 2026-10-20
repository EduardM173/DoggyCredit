/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  evaluateProviderHealth,
  PROPOSED_HEALTH_CONFIG as config,
  type ObservationStatus,
} from "./provider-health.service.js";

const now = new Date("2026-10-19T12:00:00Z");
const ago = (s: number) => new Date(now.getTime() - s * 1000);
const obs = (status: ObservationStatus, secondsAgo: number) => ({ status, at: ago(secondsAgo) });
const many = (status: ObservationStatus, n: number, secondsAgo = 60) =>
  Array.from({ length: n }, (_, i) => obs(status, secondsAgo + i));

const run = (observations = [] as ReturnType<typeof obs>[], breaker: any = { state: "CLOSED" }) =>
  evaluateProviderHealth({ observations, breaker, now, config });

describe("evaluateProviderHealth", () => {
  it("sin observaciones => SIN_SENAL_RECIENTE, nunca operativo (CA-23.01/.14)", () => {
    const r = run([]);
    expect(r.state).toBe("SIN_SENAL_RECIENTE");
    expect(r.confidence).toBe("NONE");
    expect(r.lastSignalAt).toBeNull();
  });

  it("señal vieja (fuera del TTL) => SIN_SENAL_RECIENTE (QA-S4-35)", () => {
    const r = run(many("SUCCESS", 10, 700)); // dentro de ventana 900s, fuera de TTL 600s
    expect(r.state).toBe("SIN_SENAL_RECIENTE");
    expect(r.lastSignalAt).not.toBeNull();
  });

  it("observaciones fuera de ventana se ignoran", () => {
    expect(run(many("UNAVAILABLE", 10, 2000)).state).toBe("SIN_SENAL_RECIENTE");
  });

  it("NO_DATA no cuenta como fallo (CA-23.02)", () => {
    const r = run(many("NO_DATA", 20));
    expect(r.state).toBe("OPERATIVO_OBSERVADO");
    expect(r.failures).toBe(0);
  });

  it("pocas muestras => baja confianza y no degrada", () => {
    const r = run(many("UNAVAILABLE", 4));
    expect(r.state).toBe("OPERATIVO_OBSERVADO");
    expect(r.reasonCode).toBe("LOW_SAMPLES");
    expect(r.confidence).toBe("LOW");
  });

  it("fallos >= umbral => DEGRADADO_OBSERVADO", () => {
    const r = run([...many("UNAVAILABLE", 5), ...many("SUCCESS", 5, 100)]);
    expect(r.state).toBe("DEGRADADO_OBSERVADO");
    expect(r.reasonCode).toBe("FAILURE_THRESHOLD");
  });

  it("fallos bajo el umbral => operativo", () => {
    const r = run([...many("UNAVAILABLE", 2), ...many("SUCCESS", 8, 100)]);
    expect(r.state).toBe("OPERATIVO_OBSERVADO");
    expect(r.reasonCode).toBe("HEALTHY_WINDOW");
  });

  it("breaker OPEN => degradado aunque no haya observaciones", () => {
    const r = run([], { state: "OPEN" });
    expect(r.state).toBe("DEGRADADO_OBSERVADO");
    expect(r.reasonCode).toBe("BREAKER_OPEN");
  });

  it("breaker HALF_OPEN => sigue degradado hasta recuperación comprobada (CA-23.08)", () => {
    expect(run(many("SUCCESS", 10), { state: "HALF_OPEN" }).state).toBe("DEGRADADO_OBSERVADO");
  });

  it("breaker desconocido (null) no inventa estado", () => {
    expect(run([], null).state).toBe("SIN_SENAL_RECIENTE");
  });

  it("es determinista y no muta la entrada", () => {
    const input = many("SUCCESS", 6);
    const copy = JSON.stringify(input);
    expect(run(input)).toEqual(run(input));
    expect(JSON.stringify(input)).toBe(copy);
  });

  it("config inválida lanza error", () => {
    expect(() =>
      evaluateProviderHealth({ observations: [], breaker: null, now, config: { ...config, signalTtlSeconds: 9999 } }),
    ).toThrow();
  });
});
