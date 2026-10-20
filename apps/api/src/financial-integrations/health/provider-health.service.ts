/**
 * HU-23 · T02 (DC-188) — Evaluación pura de salud observada por proveedor.
 * Sin I/O, sin Date.now(), sin Prisma: todo entra por parámetros (determinista).
 * Un GET jamás escribe: este servicio solo calcula.
 */

export type ObservationStatus = "SUCCESS" | "NO_DATA" | "UNAVAILABLE" | "ERROR";
export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export type HealthState =
  | "SIN_SENAL_RECIENTE"
  | "OPERATIVO_OBSERVADO"
  | "DEGRADADO_OBSERVADO";
// "NO_HABILITADO_PARA_TENANT" se resuelve por tenant fuera de este servicio (CA-23.13).

export type HealthReason =
  | "NO_RECENT_SIGNAL"
  | "LOW_SAMPLES"
  | "HEALTHY_WINDOW"
  | "FAILURE_THRESHOLD"
  | "BREAKER_OPEN"
  | "BREAKER_HALF_OPEN";

export type Confidence = "NONE" | "LOW" | "HIGH";

export interface ProviderObservation {
  status: ObservationStatus;
  /** respondedAt ?? requestedAt del EvaluationSourceResult. */
  at: Date;
}

export interface BreakerSnapshot {
  state: BreakerState;
}

export interface HealthConfig {
  windowSeconds: number; // HEALTH_WINDOW_SECONDS
  signalTtlSeconds: number; // HEALTH_SIGNAL_TTL_SECONDS (<= windowSeconds)
  minSamples: number; // HEALTH_MIN_SAMPLES
  failureRatioThreshold: number; // 0 < x <= 1
}

/** PROPUESTO: RF-04 no fija valores en el documento de Sprint 4. Ver HU-23-semantica-salud.md. */
export const PROPOSED_HEALTH_CONFIG: HealthConfig = {
  windowSeconds: 900,
  signalTtlSeconds: 600,
  minSamples: 5,
  failureRatioThreshold: 0.5,
};

export interface HealthEvaluation {
  state: HealthState;
  reasonCode: HealthReason;
  lastSignalAt: Date | null;
  confidence: Confidence;
  windowStart: Date;
  windowEnd: Date;
  samples: number;
  failures: number;
}

export function validateHealthConfig(c: HealthConfig): void {
  const ok =
    Number.isFinite(c.windowSeconds) && c.windowSeconds > 0 &&
    Number.isFinite(c.signalTtlSeconds) && c.signalTtlSeconds > 0 &&
    c.signalTtlSeconds <= c.windowSeconds &&
    Number.isInteger(c.minSamples) && c.minSamples >= 1 &&
    c.failureRatioThreshold > 0 && c.failureRatioThreshold <= 1;
  if (!ok) throw new Error("Invalid health configuration.");
}

export function evaluateProviderHealth(input: {
  observations: ProviderObservation[];
  /** null = estado del breaker desconocido. */
  breaker: BreakerSnapshot | null;
  now: Date;
  config: HealthConfig;
}): HealthEvaluation {
  const { observations, breaker, now, config } = input;
  validateHealthConfig(config);

  const windowEnd = now;
  const windowStart = new Date(now.getTime() - config.windowSeconds * 1000);
  const inWindow = observations.filter((o) => o.at >= windowStart && o.at <= windowEnd);

  const lastSignalAt = inWindow.length
    ? new Date(Math.max(...inWindow.map((o) => o.at.getTime())))
    : null;

  const samples = inWindow.length;
  // NO_DATA es respuesta válida del proveedor: nunca cuenta como fallo (CA-23.02).
  const failures = inWindow.filter((o) => o.status === "UNAVAILABLE" || o.status === "ERROR").length;
  const base = { lastSignalAt, windowStart, windowEnd, samples, failures };

  // El breaker abierto es evidencia propia de degradación hasta que haya recuperación comprobada.
  if (breaker?.state === "OPEN")
    return { ...base, state: "DEGRADADO_OBSERVADO", reasonCode: "BREAKER_OPEN", confidence: "HIGH" };
  if (breaker?.state === "HALF_OPEN")
    return { ...base, state: "DEGRADADO_OBSERVADO", reasonCode: "BREAKER_HALF_OPEN", confidence: "HIGH" };

  const ttlStart = now.getTime() - config.signalTtlSeconds * 1000;
  if (!lastSignalAt || lastSignalAt.getTime() < ttlStart)
    return { ...base, state: "SIN_SENAL_RECIENTE", reasonCode: "NO_RECENT_SIGNAL", confidence: "NONE" };

  if (samples < config.minSamples)
    return { ...base, state: "OPERATIVO_OBSERVADO", reasonCode: "LOW_SAMPLES", confidence: "LOW" };

  if (failures / samples >= config.failureRatioThreshold)
    return { ...base, state: "DEGRADADO_OBSERVADO", reasonCode: "FAILURE_THRESHOLD", confidence: "HIGH" };

  return { ...base, state: "OPERATIVO_OBSERVADO", reasonCode: "HEALTHY_WINDOW", confidence: "HIGH" };
}
