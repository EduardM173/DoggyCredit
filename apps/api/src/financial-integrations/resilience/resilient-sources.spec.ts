import { jest } from "@jest/globals";
import { ResilientSources } from "./resilient-sources.js";

type Deps = ConstructorParameters<typeof ResilientSources>;
/* eslint-disable @typescript-eslint/no-explicit-any */

const make = (bankQuery: () => Promise<unknown>, bureauQuery: () => Promise<unknown>) => {
  const bank = { query: jest.fn(bankQuery) };
  const bureau = { query: jest.fn(bureauQuery) };
  const sources = new ResilientSources(bank as unknown as Deps[0], bureau as unknown as Deps[1]);
  return { sources: sources as any, real: sources, bank, bureau };
};

const down = async () => ({ status: "UNAVAILABLE", providerId: "p-bureau", errorCode: "BUREAU_DOWN", retryable: true });
const ok = async () => ({ status: "SUCCESS", providerId: "p-bank", data: {} });

describe("ResilientSources (integracion del wrapper, sin BD)", () => {
  beforeAll(() => {
    process.env.PROVIDER_BACKOFF_BASE_MS = "1";
    process.env.PROVIDER_BACKOFF_MAX_MS = "2";
  });

  it("Buro caido: 4 llamadas por consulta, luego el breaker abre y ya no llama al proveedor", async () => {
    const { sources, bureau } = make(ok, down);
    await sources.queryBureau("p-bureau", "t1", "123");
    await sources.queryBureau("p-bureau", "t1", "123");
    const before = bureau.query.mock.calls.length;
    const res = await sources.queryBureau("p-bureau", "t1", "123");
    expect(bureau.query.mock.calls.length).toBe(before);
    expect(res).toMatchObject({ status: "UNAVAILABLE", errorCode: "CIRCUIT_OPEN", providerId: "p-bureau" });
  });

  it("Bank sigue operando con el Buro abierto", async () => {
    const { sources } = make(ok, down);
    await sources.queryBureau("p-bureau", "t1", "123");
    await sources.queryBureau("p-bureau", "t1", "123");
    const res = await sources.queryBank("p-bank", "t1", "123", "PERSON");
    expect(res.status).toBe("SUCCESS");
  });

  it("una excepcion del mock se convierte en UNAVAILABLE (no deja la evaluacion colgada)", async () => {
    const { sources } = make(ok, async () => {
      throw new Error("ServiceUnavailableException");
    });
    const res = await sources.queryBureau("p-bureau", "t1", "123");
    expect(res).toMatchObject({ status: "UNAVAILABLE", errorCode: "PROVIDER_EXCEPTION", providerId: "p-bureau" });
  });

  it("NO_DATA repetido: 1 llamada por consulta y el breaker no abre", async () => {
    const { sources, real, bureau } = make(ok, async () => ({ status: "NO_DATA", providerId: "p-bureau" }));
    for (let i = 0; i < 20; i++) await sources.queryBureau("p-bureau", "t1", "123");
    expect(bureau.query).toHaveBeenCalledTimes(20);
    expect(real.metrics.snapshot()[0].breaker).toBe("CLOSED");
  });
});
