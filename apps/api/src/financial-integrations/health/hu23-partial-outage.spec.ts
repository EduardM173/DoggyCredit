import { describe, expect, it } from "@jest/globals";
import { ResilientSources } from "../resilience/resilient-sources.js";

const ok = { status: "SUCCESS", providerId: "p", externalReference: "r", data: {} };
const noData = { status: "NO_DATA", providerId: "p", message: "Sin antecedentes" };
const down = { status: "UNAVAILABLE", providerId: "p", errorCode: "X", message: "caído", retryable: true };

function build(bank: unknown, bureau: unknown) {
  const calls: unknown[][] = [];
  const episodes = { onBreakerChange: (...args: unknown[]) => void calls.push(args) };
  const sources = new ResilientSources(
    { query: async () => bank } as never,
    { query: async () => bureau } as never,
    episodes as never,
  );
  return { sources, calls };
}
const breakerOf = (s: ResilientSources, code: string) =>
  s.metrics.snapshot().find((x) => x.providerCode === code)?.breaker;

describe("HU-23 T07 · caída parcial por proveedor", () => {
  it("el Buró cae, el Banco sigue y solo el Buró abre episodio", async () => {
    const { sources, calls } = build(ok, down);
    for (let i = 0; i < 15; i++) {
      await sources.queryBank("pb", "t", "1", "PERSON" as never);
      await sources.queryBureau("pu", "t", "1");
    }
    expect(breakerOf(sources, "BANK_MOCK")).toBe("CLOSED");
    expect(breakerOf(sources, "BUREAU_MOCK")).toBe("OPEN");
    expect(calls.map((c) => c[0])).toEqual(["BUREAU_MOCK"]);
    expect(calls[0]).toEqual(["BUREAU_MOCK", "CLOSED", "OPEN"]);
  }, 60_000);

  it("NO_DATA nunca cuenta como caída", async () => {
    const { sources, calls } = build(ok, noData);
    for (let i = 0; i < 15; i++) await sources.queryBureau("pu", "t", "1");
    expect(breakerOf(sources, "BUREAU_MOCK")).toBe("CLOSED");
    expect(calls).toHaveLength(0);
  }, 60_000);
});
