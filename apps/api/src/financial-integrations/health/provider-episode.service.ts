import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditWriter } from "../../audit/public.js";
import { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import type { BreakerState } from "../resilience/circuit-breaker.js";

/**
 * HU-23 · T06 (DC-320). Un EPISODIO es una degradación continua de un proveedor.
 * Se registra UNA vez por transición en AuditLog (sin tickets, sin PII, sin payloads):
 *  - CLOSED -> OPEN        => PROVIDER_DEGRADED (abre episodio con episodeId UUID)
 *  - HALF_OPEN -> CLOSED   => PROVIDER_RECOVERED (misma episodeId; recuperación con evidencia: sonda exitosa)
 *  - OPEN <-> HALF_OPEN    => nada (mismo episodio)
 * Nunca escribe IntegrationProvider.status (providerAcceptsQueries bloquearía la sonda half-open).
 */
export type EpisodeDecision = { kind: "OPEN" } | { kind: "CLOSE"; episodeId: string } | { kind: "NONE" };

export function decideEpisodeAction(input: {
  from: BreakerState;
  to: BreakerState;
  openEpisodeId: string | null;
}): EpisodeDecision {
  if (input.from === "CLOSED" && input.to === "OPEN")
    return input.openEpisodeId ? { kind: "NONE" } : { kind: "OPEN" };
  if (input.from === "HALF_OPEN" && input.to === "CLOSED")
    return input.openEpisodeId ? { kind: "CLOSE", episodeId: input.openEpisodeId } : { kind: "NONE" };
  return { kind: "NONE" };
}

@Injectable()
export class ProviderEpisodeService {
  private readonly logger = new Logger(ProviderEpisodeService.name);

  constructor(
    private readonly audit: AuditWriter,
    private readonly database: DatabaseUnitOfWork,
  ) {}

  /** Para el callback síncrono del breaker: nunca lanza ni bloquea la consulta al proveedor. */
  onBreakerChange(providerCode: string, from: BreakerState, to: BreakerState): void {
    this.handle(providerCode, from, to).catch(() =>
      this.logger.warn(`[${providerCode}] no se pudo registrar la transición de salud`),
    );
  }

  async handle(providerCode: string, from: BreakerState, to: BreakerState): Promise<EpisodeDecision> {
    const relevant = (from === "CLOSED" && to === "OPEN") || (from === "HALF_OPEN" && to === "CLOSED");
    if (!relevant) return { kind: "NONE" };

    const provider = await this.database.client.integrationProvider.findUnique({
      where: { code: providerCode },
      select: { id: true },
    });
    if (!provider) return { kind: "NONE" };

    const open = await this.audit.findOpenProviderEpisode(provider.id);
    const decision = decideEpisodeAction({ from, to, openEpisodeId: open?.episodeId ?? null });

    if (decision.kind === "OPEN")
      await this.audit.recordProviderHealthTransition({
        providerId: provider.id,
        providerCode,
        action: "PROVIDER_DEGRADED",
        from,
        to,
        episodeId: randomUUID(),
      });
    if (decision.kind === "CLOSE")
      await this.audit.recordProviderHealthTransition({
        providerId: provider.id,
        providerCode,
        action: "PROVIDER_RECOVERED",
        from,
        to,
        episodeId: decision.episodeId,
      });
    return decision;
  }
}
