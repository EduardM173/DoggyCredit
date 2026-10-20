import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AuditWriter } from "../audit/public.js";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import {
  PROVIDER_CATALOG,
  SIMULATION_SCENARIOS,
  SOURCE_COVERAGE,
  SOURCE_PROVIDER_CODES,
  isSourceProviderCode,
  providerAcceptsQueries,
  type SourceProviderCode,
  type SourceSubjectType,
} from "./source-contracts.js";

/**
 * HU-30. Vista administrativa de un proveedor simulado.
 * Mantiene separados los tres hechos de CA-30.05:
 *  - `global`: habilitación decidida por PLATFORM_ADMIN;
 *  - `health`: salud observada del proveedor;
 *  - `tenants`: cuántas instituciones lo habilitaron (solo agregados).
 * Nunca incluye URLs, claves, timeouts ni datos de solicitantes.
 */
export interface ProviderAdminView {
  code: SourceProviderCode;
  name: string;
  kind: "BANK" | "CREDIT_BUREAU";
  description: string;
  registered: boolean;
  coverage: { subjectTypes: SourceSubjectType[] };
  global: { enabled: boolean; changedAt: string | null };
  health: { status: "ACTIVE" | "DEGRADED" | "INACTIVE" };
  tenants: { enabled: number };
  acceptsNewQueries: boolean;
  simulationScenarios?: typeof SIMULATION_SCENARIOS;
}

export interface ProviderGlobalChange {
  provider: ProviderAdminView;
  changed: boolean;
}

@Injectable()
export class ProviderAdministrationService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly audit: AuditWriter,
    private readonly config: ConfigService,
  ) {}

  async list(): Promise<ProviderAdminView[]> {
    return Promise.all(SOURCE_PROVIDER_CODES.map((code) => this.view(code, false)));
  }

  async detail(code: string): Promise<ProviderAdminView> {
    return this.view(this.knownCode(code), true);
  }

  /**
   * Cambia únicamente la habilitación global. No toca evaluaciones, resultados por fuente ni
   * la habilitación de cada institución (CA-30.03). La actualización condicional hace el cambio
   * atómico y evita auditar dos veces el mismo cambio concurrente.
   */
  async setGlobalEnabled(
    code: string,
    enabled: boolean,
    actorUserId: string,
    reason?: string,
  ): Promise<ProviderGlobalChange> {
    const providerCode = this.knownCode(code);
    const changed = await this.db.run(async () => {
      const current = await this.db.client.integrationProvider.findUnique({
        where: { code: providerCode },
        select: { id: true },
      });
      if (!current) throw new NotFoundException("El proveedor no está registrado en la plataforma.");
      const result = await this.db.client.integrationProvider.updateMany({
        where: { code: providerCode, globallyEnabled: !enabled },
        data: { globallyEnabled: enabled, globalChangedAt: new Date() },
      });
      if (result.count === 0) return false;
      await this.audit.recordProviderAdministration({
        actorUserId,
        providerId: current.id,
        providerCode,
        action: enabled ? "PROVIDER_GLOBALLY_ENABLED" : "PROVIDER_GLOBALLY_DISABLED",
        previousEnabled: !enabled,
        currentEnabled: enabled,
        reason: reason?.trim() || undefined,
      });
      return true;
    });
    return { provider: await this.view(providerCode, true), changed };
  }

  private knownCode(code: string): SourceProviderCode {
    if (!isSourceProviderCode(code)) throw new NotFoundException("El proveedor no existe.");
    return code;
  }

  private async view(code: SourceProviderCode, withScenarios: boolean): Promise<ProviderAdminView> {
    const catalog = PROVIDER_CATALOG[code];
    const provider = await this.db.client.integrationProvider.findUnique({
      where: { code },
      select: { id: true, status: true, globallyEnabled: true, globalChangedAt: true },
    });
    const enabledTenants = provider
      ? await this.db.client.tenantIntegration.count({
          where: { providerId: provider.id, enabled: true, status: "ACTIVE" },
        })
      : 0;
    const showScenarios = withScenarios && this.config.get<string>("NODE_ENV") !== "production";
    return {
      code,
      name: catalog.name,
      kind: catalog.kind,
      description: catalog.description,
      registered: Boolean(provider),
      coverage: { subjectTypes: [...SOURCE_COVERAGE[code]] },
      global: {
        enabled: provider ? provider.globallyEnabled !== false : false,
        changedAt: provider?.globalChangedAt ? provider.globalChangedAt.toISOString() : null,
      },
      health: { status: provider ? (provider.status as ProviderAdminView["health"]["status"]) : "INACTIVE" },
      tenants: { enabled: enabledTenants },
      acceptsNewQueries: provider ? providerAcceptsQueries(provider) : false,
      ...(showScenarios ? { simulationScenarios: SIMULATION_SCENARIOS } : {}),
    };
  }
}
