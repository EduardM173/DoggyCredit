import { jest } from "@jest/globals";
import { BankMockSourceService } from "./bank-mock-source.service.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockFn = jest.Mock<any>;

/**
 * S4-HF-07 — Habilitar empresa solo con cobertura real de mocks.
 * Pruebas de reproducción de la cobertura declarada y de los datos que
 * devuelve el Banco Mock según el tipo de sujeto.
 */
describe("S4-HF-07 — Cobertura de las fuentes simuladas por tipo de sujeto", () => {
  let mockDb: {
    client: {
      integrationProvider: { findUnique: MockFn };
      tenantIntegration: { findUnique: MockFn };
    };
  };
  let bank: BankMockSourceService;

  beforeEach(() => {
    mockDb = {
      client: {
        integrationProvider: {
          findUnique: jest.fn<any>().mockResolvedValue({ id: "p-bank", status: "ACTIVE" }),
        },
        tenantIntegration: {
          findUnique: jest.fn<any>().mockResolvedValue({ enabled: true, status: "ACTIVE" }),
        },
      },
    };
    bank = new BankMockSourceService(mockDb as unknown as DatabaseUnitOfWork);
  });

  it("HF-07/1: declara que el Banco cubre personas y empresas y que el Buró solo cubre personas", async () => {
    const pub = (await import("./public.js")) as any;

    expect(pub.sourceCoversSubject("BANK_MOCK", "PERSON")).toBe(true);
    expect(pub.sourceCoversSubject("BANK_MOCK", "COMPANY")).toBe(true);
    expect(pub.sourceCoversSubject("BUREAU_MOCK", "PERSON")).toBe(true);
    expect(pub.sourceCoversSubject("BUREAU_MOCK", "COMPANY")).toBe(false);
  });

  it("HF-07/2: el Banco Mock devuelve datos a escala empresarial cuando el sujeto es una empresa (NIT)", async () => {
    const person = await (bank as any).query("tenant-1", "1020304050", "PERSON");
    const company = await (bank as any).query("tenant-1", "1020304050", "COMPANY");

    expect(person.status).toBe("SUCCESS");
    expect(company.status).toBe("SUCCESS");
    expect(company.data.accounts[0].averageMonthlyInflow).toBeGreaterThan(
      person.data.accounts[0].averageMonthlyInflow,
    );
    expect(company.data.loans[0].loanType).toBe("COMMERCIAL");
  });

  it("HF-07/3: los escenarios de fixture (NO_DATA, UNAVAILABLE, ERROR) se mantienen para empresas", async () => {
    const noData = await (bank as any).query("tenant-1", "9000000", "COMPANY");
    const unavailable = await (bank as any).query("tenant-1", "1020304999", "COMPANY");
    const failed = await (bank as any).query("tenant-1", "1020304500", "COMPANY");

    expect(noData.status).toBe("NO_DATA");
    expect(unavailable.status).toBe("UNAVAILABLE");
    expect(failed.status).toBe("ERROR");
  });
});
