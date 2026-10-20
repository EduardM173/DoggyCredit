import { describe, expect, it, jest } from "@jest/globals";
import { AuditService } from "./audit.service.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
describe("AuditService", () => {
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

  describe("HU-24 Consultar eventos auditados institucional y plataforma", () => {
    it("CA-24.03: queryInstitutionAudit aísla estrictamente por tenantId", async () => {
      const count = jest.fn<any>().mockResolvedValue(1);
      const findMany = jest.fn<any>().mockResolvedValue([
        {
          id: "log-1",
          createdAt: new Date("2026-10-15T12:00:00.000Z"),
          action: "EVALUATION_PROCESSED",
          entityType: "Evaluation",
          entityId: "eval-123",
          metadata: { finalStatus: "COMPLETED", secretToken: "tok_secret_123" },
          actor: { id: "user-1", fullName: "Carlos Analista", email: "carlos@bancox.com" },
        },
      ]);

      const audit = new AuditService({ client: { auditLog: { count, findMany } } } as unknown as DatabaseUnitOfWork);

      const result = await audit.queryInstitutionAudit("tenant-banco-x", { page: 1, pageSize: 20 }, "banco-x");

      expect(count).toHaveBeenCalledWith({
        where: { tenantId: "tenant-banco-x" },
      });
      expect(findMany).toHaveBeenCalledWith({
        where: { tenantId: "tenant-banco-x" },
        include: { actor: { select: { id: true, fullName: true, email: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: 0,
        take: 20,
      });

      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
      const item = result.items[0]!;
      expect(item.action).toBe("EVALUATION_PROCESSED");
      expect(item.actionLabel).toBe("Evaluación crediticia procesada");
      expect(item.category).toBe("EVALUATION");
      expect(item.outcome).toBe("SUCCESS");
      expect(item.resourceLink).toBe("/banco-x/evaluaciones/eval-123");
      expect(item.actor.name).toBe("Carlos Analista");
      expect(item.actor.email).toBe("carlos@bancox.com");
      expect(item.summary).toContain("dictamen final: COMPLETED");

      // CA-24.08 / CA-24.12: metadatos sensibles son redactados
      expect(item.metadata).toEqual({ finalStatus: "COMPLETED" });
      expect((item.metadata as any).secretToken).toBeUndefined();
    });

    it("aplica filtros de categoría y rango de fechas correctamente", async () => {
      const count = jest.fn<any>().mockResolvedValue(0);
      const findMany = jest.fn<any>().mockResolvedValue([]);

      const audit = new AuditService({ client: { auditLog: { count, findMany } } } as unknown as DatabaseUnitOfWork);

      await audit.queryInstitutionAudit("tenant-banco-x", {
        category: "CATALOG",
        from: "2026-10-01",
        to: "2026-10-20",
        page: 2,
        pageSize: 10,
      });

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: "tenant-banco-x",
            action: {
              in: [
                "PRODUCT_CREATED",
                "PRODUCT_UPDATED",
                "PRODUCT_ACTIVATED",
                "PRODUCT_DEACTIVATED",
                "INSTITUTION_PRODUCTS_CONFIRMED",
              ],
            },
            createdAt: expect.objectContaining({
              gte: new Date("2026-10-01T00:00:00.000Z"),
              lte: new Date("2026-10-20T23:59:59.999Z"),
            }),
          }),
          skip: 10,
          take: 10,
        }),
      );
    });

    it("CA-24.04: queryPlatformAudit no expone evaluaciones de clientes ni expedientes", async () => {
      const count = jest.fn<any>().mockResolvedValue(1);
      const findMany = jest.fn<any>().mockResolvedValue([
        {
          id: "log-p1",
          createdAt: new Date("2026-10-14T10:00:00.000Z"),
          action: "PROVIDER_GLOBALLY_DISABLED",
          entityType: "IntegrationProvider",
          entityId: "prov-bank",
          metadata: { providerCode: "BANK_MOCK", reason: "Mantenimiento programado" },
          actor: { id: "op-1", fullName: "Operador Doggy", email: "op@doggycredit.com" },
        },
      ]);

      const audit = new AuditService({ client: { auditLog: { count, findMany } } } as unknown as DatabaseUnitOfWork);

      const result = await audit.queryPlatformAudit({ page: 1, pageSize: 20 });

      // Verifica que el filtro no permita entidades sensibles
      expect(count).toHaveBeenCalledWith({
        where: {
          OR: [
            { tenantId: null },
            {
              entityType: {
                in: [
                  "InstitutionRequest",
                  "Contracting",
                  "Payment",
                  "Tenant",
                  "IntegrationProvider",
                  "TenantProvisioning",
                ],
              },
            },
          ],
        },
      });

      expect(result.items[0]!.action).toBe("PROVIDER_GLOBALLY_DISABLED");
      expect(result.items[0]!.category).toBe("PLATFORM");
      expect(result.items[0]!.outcome).toBe("FAILURE");
      expect(result.items[0]!.actor.type).toBe("OPERATOR");
      expect(result.items[0]!.actor.name).toBe("Operador Doggy");
      expect(result.items[0]!.resourceLink).toBe("/admin/proveedores");
    });
  });
});
