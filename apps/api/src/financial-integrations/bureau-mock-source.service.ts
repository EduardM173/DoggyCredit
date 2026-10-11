import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { BureauMockSource, type SourceStatus } from "./public.js";

@Injectable()
export class BureauMockSourceService extends BureauMockSource {
  constructor(private readonly db: DatabaseUnitOfWork) {
    super();
  }

  async status(tenantId: string): Promise<SourceStatus> {
    const provider = await this.db.client.integrationProvider.findUnique({
      where: { code: "BUREAU_MOCK" },
      select: { id: true, status: true },
    });
    if (!provider) {
      return { available: false, enabled: false, healthStatus: "INACTIVE" };
    }
    const source = await this.db.client.tenantIntegration.findUnique({
      where: { tenantId_providerId: { tenantId, providerId: provider.id } },
      select: { enabled: true, status: true },
    });
    const isAvailable = provider.status === "ACTIVE";
    return {
      available: isAvailable,
      enabled: isAvailable && source?.enabled === true && source.status === "ACTIVE",
      healthStatus: provider.status as "ACTIVE" | "DEGRADED" | "INACTIVE",
    };
  }

  async enable(tenantId: string, enabled = true): Promise<boolean> {
    const provider = await this.db.client.integrationProvider.findUnique({
      where: { code: "BUREAU_MOCK" },
    });
    if (!provider || provider.status !== "ACTIVE") {
      throw new ServiceUnavailableException(
        "El Buró crediticio simulado no está disponible en la plataforma. Intenta nuevamente más tarde.",
      );
    }
    const current = await this.db.client.tenantIntegration.findUnique({
      where: { tenantId_providerId: { tenantId, providerId: provider.id } },
    });
    const currentEnabled = current?.enabled === true && current.status === "ACTIVE";
    if (currentEnabled === enabled) {
      return false;
    }
    await this.db.client.tenantIntegration.upsert({
      where: { tenantId_providerId: { tenantId, providerId: provider.id } },
      update: { enabled, status: "ACTIVE", lastErrorCode: null },
      create: { tenantId, providerId: provider.id, enabled, status: "ACTIVE" },
    });
    return true;
  }
}
