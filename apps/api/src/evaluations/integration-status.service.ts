import { Injectable } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import {
  ProviderHealthReadService,
  type IntegrationHealthSummary,
} from "../financial-integrations/health/provider-health-read.service.js";

export type IntegrationAvailability = "AVAILABLE" | "TEMPORARILY_UNAVAILABLE" | "UNKNOWN";

/** Contrato para el analista (HU-23 / T05). Sin datos del breaker, sin conteos, sin otras instituciones. */
export interface IntegrationStatusItem {
  providerName: string;
  availability: IntegrationAvailability;
  message: string;
}

/**
 * Traducción pura del estado interno al lenguaje de la institución.
 * Un NO_DATA nunca llega aquí como fallo: la salud ya lo trata como respuesta válida.
 */
export function toStatusItem(
  summary: Pick<IntegrationHealthSummary, "name" | "globallyEnabled" | "health">,
): IntegrationStatusItem {
  if (!summary.globallyEnabled) {
    return {
      providerName: summary.name,
      availability: "TEMPORARILY_UNAVAILABLE",
      message: "La plataforma deshabilitó temporalmente esta fuente. Las nuevas consultas no la usarán.",
    };
  }
  switch (summary.health.state) {
    case "DEGRADADO_OBSERVADO":
      return {
        providerName: summary.name,
        availability: "TEMPORARILY_UNAVAILABLE",
        message: "Está con interrupciones temporales. Una evaluación nueva puede fallar y se podrá reintentar.",
      };
    case "OPERATIVO_OBSERVADO":
      return { providerName: summary.name, availability: "AVAILABLE", message: "Disponible." };
    default:
      return {
        providerName: summary.name,
        availability: "UNKNOWN",
        message: "Sin información reciente sobre su disponibilidad.",
      };
  }
}

@Injectable()
export class IntegrationStatusService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly health: ProviderHealthReadService,
  ) {}

  /** Solo lectura. Devuelve únicamente las fuentes que ESTA institución tiene habilitadas. */
  async forTenant(tenantId: string): Promise<IntegrationStatusItem[]> {
    const links = await this.db.client.tenantIntegration.findMany({
      where: { tenantId, enabled: true, status: "ACTIVE" },
      select: { providerId: true },
    });
    if (links.length === 0) return [];
    const providers = await this.db.client.integrationProvider.findMany({
      where: { id: { in: links.map((l) => l.providerId) } },
      select: { code: true },
    });
    const codes = new Set<string>(providers.map((p) => p.code));
    const all = await this.health.list();
    return all.filter((h) => codes.has(h.code)).map(toStatusItem);
  }
}