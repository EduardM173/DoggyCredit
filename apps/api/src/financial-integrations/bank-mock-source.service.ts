import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { BankMockSource } from "./public.js";

@Injectable()
export class BankMockSourceService extends BankMockSource {
  constructor(private readonly db: DatabaseUnitOfWork) {
    super();
  }

  async status(tenantId: string) {
    const provider = await this.db.client.integrationProvider.findUnique({
      where: { code: "BANK_MOCK" },
      select: { id: true, status: true },
    });
    if (!provider) return { available: false, enabled: false };
    const source = await this.db.client.tenantIntegration.findUnique({
      where: { tenantId_providerId: { tenantId, providerId: provider.id } },
      select: { enabled: true, status: true },
    });
    return {
      available: provider.status === "ACTIVE",
      enabled: provider.status === "ACTIVE" && source?.enabled === true && source.status === "ACTIVE",
    };
  }

  async enable(tenantId: string) {
    const provider = await this.db.client.integrationProvider.findUnique({ where: { code: "BANK_MOCK" } });
    if (provider?.status !== "ACTIVE")
      throw new ServiceUnavailableException(
        "La fuente bancaria no está disponible. Intenta nuevamente más tarde.",
      );
    const current = await this.db.client.tenantIntegration.findUnique({
      where: { tenantId_providerId: { tenantId, providerId: provider.id } },
    });
    if (current?.enabled && current.status === "ACTIVE") return false;
    await this.db.client.tenantIntegration.upsert({
      where: { tenantId_providerId: { tenantId, providerId: provider.id } },
      update: { enabled: true, status: "ACTIVE", lastErrorCode: null },
      create: { tenantId, providerId: provider.id, enabled: true, status: "ACTIVE" },
    });
    return true;
  }
}
