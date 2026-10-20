import { describe, expect, it } from "@jest/globals";
import { GUARDS_METADATA } from "@nestjs/common/constants.js";
import { InstitutionSessionGuard, TenantContextGuard } from "../identity-tenants/public.js";
import { IntegrationStatusController } from "./integration-status.controller.js";
import { IntegrationStatusService } from "./integration-status.service.js";

const summary = (code: string, name: string, state: string) => ({
  code, name, globallyEnabled: true, health: { state, lastSignalAt: "2026-10-20T10:00:00Z", confidence: "HIGH" },
  tenants: { enabled: 9, affected: { known: true, count: 7 } },
});

function service(enabledCodes: string[]) {
  const db = {
    client: {
      tenantIntegration: { findMany: async () => enabledCodes.map((c) => ({ providerId: `id-${c}` })) },
      integrationProvider: { findMany: async () => enabledCodes.map((c) => ({ code: c })) },
    },
  };
  const health = {
    list: async () => [
      summary("BANK_MOCK", "Fuente bancaria simulada", "OPERATIVO_OBSERVADO"),
      summary("BUREAU_MOCK", "Buró crediticio simulado", "DEGRADADO_OBSERVADO"),
    ],
  };
  return new IntegrationStatusService(db as never, health as never);
}

describe("HU-23 T07 · estado para la institución", () => {
  it("devuelve solo las fuentes que la institución habilitó", async () => {
    const items = await service(["BANK_MOCK"]).forTenant("t1");
    expect(items.map((i) => i.providerName)).toEqual(["Fuente bancaria simulada"]);
  });
  it("sin fuentes habilitadas devuelve lista vacía", async () => {
    expect(await service([]).forTenant("t1")).toEqual([]);
  });
  it("escaneo profundo: no filtra breaker, conteos, episodios ni otras instituciones", async () => {
    const items = await service(["BANK_MOCK", "BUREAU_MOCK"]).forTenant("t1");
    const json = JSON.stringify(items);
    expect(json).not.toMatch(/breaker|OPEN|HALF_OPEN|episode|INSTANCIA_API|reasonCode|samples|failures|affected|count|tenants|confidence|lastSignalAt|BUREAU_MOCK|BANK_MOCK/i);
    for (const item of items) expect(Object.keys(item).sort()).toEqual(["availability", "message", "providerName"]);
  });
  it("el controlador exige sesión institucional y contexto de institución", () => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, IntegrationStatusController) as unknown[];
    expect(guards).toEqual([InstitutionSessionGuard, TenantContextGuard]);
  });
});