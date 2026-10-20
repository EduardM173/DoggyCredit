import { Injectable } from "@nestjs/common";
import { AuditWriter } from "../../audit/public.js";
import { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import { PROVIDER_CATALOG, SOURCE_PROVIDER_CODES, isSourceProviderCode, type SourceProviderCode } from "../public.js";
import { ResilientSources } from "../resilience/resilient-sources.js";
import type { BreakerState } from "../resilience/circuit-breaker.js";
import { healthConfig } from "./health.config.js";
import {
  evaluateProviderHealth,
  type BreakerSnapshot,
  type Confidence,
  type HealthEvaluation,
  type HealthState,
  type ObservationStatus,
  type ProviderObservation,
} from "./provider-health.service.js";
import { NotFoundException } from "@nestjs/common";

export type MonitoredState = HealthState | "ERROR_MONITOREO";

export interface IntegrationHealthSummary {
  code: SourceProviderCode;
  name: string;
  globallyEnabled: boolean;
  health: { state: MonitoredState; lastSignalAt: string | null; confidence: Confidence | "UNKNOWN" };
  tenants: { enabled: number; affected: { known: boolean; count: number | null } };
}

export interface IntegrationHealthDetail extends IntegrationHealthSummary {
  health: IntegrationHealthSummary["health"] & {
    windowStart: string | null;
    windowEnd: string | null;
    label: string;
    explanation: string;
    nextStep: string;
  };
  episode: { episodeId: string; startedAt: string } | null;
  protection: { label: string };
  affectedTenants: { name: string }[];
  /** Solo roles internos. Los códigos crudos del breaker viven únicamente aquí (CA-23.07). */
  advanced: {
    breakerState: BreakerState | "DESCONOCIDO";
    scope: "INSTANCIA_API";
    reasonCode: string;
    samples: number;
    failures: number;
  };
}

/**
 * Recuperación con evidencia (CA-23.08). Si hay episodio abierto y el breaker local no dice OPEN/HALF_OPEN,
 * solo se considera recuperado si, desde que empezó el episodio, hay >= minSamples respuestas válidas y ningún fallo.
 */
export function effectiveBreaker(input: {
  local: BreakerState | null;
  openEpisode: { startedAt: Date } | null;
  observations: ProviderObservation[];
  minSamples: number;
}): BreakerSnapshot | null {
  const { local, openEpisode } = input;
  if (local === "OPEN" || local === "HALF_OPEN") return { state: local };
  if (!openEpisode) return local ? { state: local } : null;
  const after = input.observations.filter((o) => o.at > openEpisode.startedAt);
  const valid = after.filter((o) => o.status === "SUCCESS" || o.status === "NO_DATA").length;
  return valid >= input.minSamples && after.length === valid ? { state: "CLOSED" } : { state: "OPEN" };
}

const STATE_LABEL: Record<MonitoredState, string> = {
  SIN_SENAL_RECIENTE: "Sin señal reciente",
  OPERATIVO_OBSERVADO: "Operativo (observado)",
  DEGRADADO_OBSERVADO: "Degradado (observado)",
  ERROR_MONITOREO: "Error de monitoreo",
};

const EXPLANATION: Record<string, string> = {
  NO_RECENT_SIGNAL: "No tenemos una comprobación reciente del estado de este proveedor.",
  LOW_SAMPLES: "Hay pocas comprobaciones recientes; la confianza de este estado es baja.",
  HEALTHY_WINDOW: "Las consultas recientes al proveedor respondieron con normalidad.",
  FAILURE_THRESHOLD: "Una parte importante de las consultas recientes no obtuvo respuesta del proveedor.",
  BREAKER_OPEN: "Hay protección temporal activa: se detuvieron nuevas consultas al proveedor tras fallos repetidos.",
  BREAKER_HALF_OPEN: "Se está comprobando si el proveedor ya se recuperó con una consulta de prueba.",
  MONITOR_ERROR: "No pudimos leer la información de monitoreo. Esto no indica que el proveedor esté sano.",
};

const NEXT_STEP: Record<string, string> = {
  NO_RECENT_SIGNAL: "Espera nuevas consultas o revisa el proveedor simulado.",
  LOW_SAMPLES: "Espera más consultas para confirmar el estado.",
  HEALTHY_WINDOW: "No hace falta ninguna acción.",
  FAILURE_THRESHOLD: "Revisa el proveedor simulado; la protección temporal se levantará sola cuando la comprobación sea exitosa.",
  BREAKER_OPEN: "Revisa el proveedor simulado; la protección temporal se levantará sola cuando la comprobación sea exitosa.",
  BREAKER_HALF_OPEN: "Espera el resultado de la comprobación; no hace falta ninguna acción.",
  MONITOR_ERROR: "Vuelve a actualizar en unos minutos. Si persiste, avisa al equipo técnico.",
};

const PROTECTION_LABEL = (b: BreakerSnapshot | null): string =>
  b?.state === "OPEN"
    ? "Protección temporal activa"
    : b?.state === "HALF_OPEN"
      ? "Comprobando recuperación"
      : b?.state === "CLOSED"
        ? "Operativo"
        : "Sin información";

/**
 * HU-23 · T03/T04 (lectura). SOLO LECTURA: no escribe en base de datos, no llama al proveedor
 * y no fuerza transiciones del breaker (usa metrics.snapshot(), no getState()). Un GET nunca cambia estado.
 * El breaker es por proveedor, en memoria y por instancia de la API; los episodios (AuditLog) son compartidos.
 */
@Injectable()
export class ProviderHealthReadService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly audit: AuditWriter,
    private readonly resilient: ResilientSources,
  ) {}

  protected now(): Date {
    return new Date();
  }

  list(): Promise<IntegrationHealthSummary[]> {
    return Promise.all(SOURCE_PROVIDER_CODES.map((code) => this.build(code, false) as Promise<IntegrationHealthSummary>));
  }

  detail(code: string): Promise<IntegrationHealthDetail> {
    if (!isSourceProviderCode(code)) throw new NotFoundException("El proveedor no existe.");
    return this.build(code, true) as Promise<IntegrationHealthDetail>;
  }

  private async build(code: SourceProviderCode, withDetail: boolean) {
    const catalog = PROVIDER_CATALOG[code];
    const base = { code, name: catalog.name };
    try {
      const provider = await this.db.client.integrationProvider.findUnique({
        where: { code },
        select: { id: true, globallyEnabled: true },
      });
      const now = this.now();
      const cfg = healthConfig();
      if (!provider) {
        const ev = evaluateProviderHealth({ observations: [], breaker: null, now, config: cfg });
        return this.shape(base, false, 0, ev, null, null, [], withDetail, { known: false, count: null });
      }

      const windowStart = new Date(now.getTime() - cfg.windowSeconds * 1000);
      const rows = await this.db.client.evaluationSourceResult.findMany({
        where: { providerId: provider.id, requestedAt: { gte: windowStart } },
        select: { status: true, requestedAt: true, respondedAt: true, tenantId: true },
        orderBy: { requestedAt: "desc" },
        take: 5000,
      });
      const observations: ProviderObservation[] = rows.map((r) => ({
        status: r.status as ObservationStatus,
        at: r.respondedAt ?? r.requestedAt,
      }));
      const openEpisode = await this.audit.findOpenProviderEpisode(provider.id);
      const local = this.resilient.metrics.snapshot().find((s) => s.providerCode === code)?.breaker ?? null;
      const breaker = effectiveBreaker({ local, openEpisode, observations, minSamples: cfg.minSamples });
      const ev = evaluateProviderHealth({ observations, breaker, now, config: cfg });

      const enabled = await this.db.client.tenantIntegration.count({
        where: { providerId: provider.id, enabled: true, status: "ACTIVE" },
      });
      const failedTenantIds = [
        ...new Set(rows.filter((r) => r.status === "UNAVAILABLE" || r.status === "ERROR").map((r) => r.tenantId)),
      ];
      // Desconocido (sin señal) != ninguno afectado (CA-23.05).
      const affected =
        ev.state === "SIN_SENAL_RECIENTE"
          ? { known: false, count: null }
          : { known: true, count: ev.state === "DEGRADADO_OBSERVADO" ? failedTenantIds.length : 0 };

      let names: { name: string }[] = [];
      if (withDetail && ev.state === "DEGRADADO_OBSERVADO" && failedTenantIds.length) {
        const tenants = await this.db.client.tenant.findMany({
          where: { id: { in: failedTenantIds } },
          select: { legalName: true },
        });
        names = tenants.map((t) => ({ name: t.legalName }));
      }
      return this.shape(base, provider.globallyEnabled !== false, enabled, ev, breaker, local, names, withDetail, affected, openEpisode);
    } catch {
      // Falla de monitoreo: nunca se muestra como "operativo" (CA-23.11).
      const summary = {
        ...base,
        globallyEnabled: true,
        health: { state: "ERROR_MONITOREO" as const, lastSignalAt: null, confidence: "UNKNOWN" as const },
        tenants: { enabled: 0, affected: { known: false, count: null } },
      };
      if (!withDetail) return summary;
      return {
        ...summary,
        health: {
          ...summary.health,
          windowStart: null,
          windowEnd: null,
          label: STATE_LABEL.ERROR_MONITOREO,
          explanation: EXPLANATION.MONITOR_ERROR,
          nextStep: NEXT_STEP.MONITOR_ERROR,
        },
        episode: null,
        protection: { label: "Sin información" },
        affectedTenants: [],
        advanced: { breakerState: "DESCONOCIDO" as const, scope: "INSTANCIA_API" as const, reasonCode: "MONITOR_ERROR", samples: 0, failures: 0 },
      };
    }
  }

  private shape(
    base: { code: SourceProviderCode; name: string },
    globallyEnabled: boolean,
    enabled: number,
    ev: HealthEvaluation,
    breaker: BreakerSnapshot | null,
    local: BreakerState | null,
    affectedTenants: { name: string }[],
    withDetail: boolean,
    affected: { known: boolean; count: number | null },
    openEpisode: { episodeId: string; startedAt: Date } | null = null,
  ) {
    const summary: IntegrationHealthSummary = {
      ...base,
      globallyEnabled,
      health: { state: ev.state, lastSignalAt: ev.lastSignalAt?.toISOString() ?? null, confidence: ev.confidence },
      tenants: { enabled, affected },
    };
    if (!withDetail) return summary;
    return {
      ...summary,
      health: {
        ...summary.health,
        windowStart: ev.windowStart.toISOString(),
        windowEnd: ev.windowEnd.toISOString(),
        label: STATE_LABEL[ev.state],
        explanation: EXPLANATION[ev.reasonCode],
        nextStep: NEXT_STEP[ev.reasonCode],
      },
      episode: openEpisode
        ? { episodeId: openEpisode.episodeId, startedAt: openEpisode.startedAt.toISOString() }
        : null,
      protection: { label: PROTECTION_LABEL(breaker) },
      affectedTenants,
      advanced: {
        breakerState: local ?? "DESCONOCIDO",
        scope: "INSTANCIA_API" as const,
        reasonCode: ev.reasonCode,
        samples: ev.samples,
        failures: ev.failures,
      },
    } satisfies IntegrationHealthDetail;
  }
}
