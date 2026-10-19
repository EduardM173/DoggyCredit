import { jest } from "@jest/globals";
import { AuditService } from "./audit.service.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
describe("HU-30 CA-30.07 auditoría de proveedores", () => {
  it("guarda un evento de plataforma sin tenant y sin datos sensibles", async () => {
    const create = jest.fn<any>().mockResolvedValue({});
    const audit = new AuditService({ client: { auditLog: { create } } } as unknown as DatabaseUnitOfWork);
    await audit.recordProviderAdministration({
      actorUserId: "admin-1",
      providerId: "prov-1",
      providerCode: "BANK_MOCK",
      action: "PROVIDER_GLOBALLY_DISABLED",
      previousEnabled: true,
      currentEnabled: false,
      reason: "Mantenimiento",
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId: null,
        actorUserId: "admin-1",
        action: "PROVIDER_GLOBALLY_DISABLED",
        entityType: "IntegrationProvider",
        entityId: "prov-1",
        metadata: {
          providerCode: "BANK_MOCK",
          previousEnabled: true,
          currentEnabled: false,
          reason: "Mantenimiento",
        },
      },
    });
  });

  it("omite el motivo cuando no se informa", async () => {
    const create = jest.fn<any>().mockResolvedValue({});
    const audit = new AuditService({ client: { auditLog: { create } } } as unknown as DatabaseUnitOfWork);
    await audit.recordProviderAdministration({
      actorUserId: "admin-1",
      providerId: "prov-1",
      providerCode: "BUREAU_MOCK",
      action: "PROVIDER_GLOBALLY_ENABLED",
      previousEnabled: false,
      currentEnabled: true,
    });
    expect(create.mock.calls[0]![0]).toMatchObject({
      data: { metadata: { providerCode: "BUREAU_MOCK", previousEnabled: false, currentEnabled: true } },
    });
    expect(JSON.stringify(create.mock.calls[0]![0])).not.toContain("reason");
  });
});
