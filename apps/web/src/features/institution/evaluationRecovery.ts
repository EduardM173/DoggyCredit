import { institutionApi } from "./api";

/** HU-25: campos de recuperación que devuelve el backend (pueden faltar en respuestas antiguas). */
export type EvaluationTracking =
  | "ACTIVE_WAIT"
  | "PROGRESS_STALLED"
  | "PROVIDER_ISSUE"
  | "FAILED"
  | "FINAL";

export interface RecoveryFields {
  tracking: EvaluationTracking;
  retry: { allowed: boolean; reason: string; remainingAttempts: number; maxAttempts: number };
  coverage: { achieved: string; missing: string; nextAction: string };
  sourceStatuses: Array<{
    providerCode: string | null;
    providerName: string | null;
    status: "SUCCESS" | "NO_DATA" | "UNAVAILABLE" | "ERROR";
    errorCode: string | null;
    asOf: string | null;
  }>;
}

/** PROPUESTO: espera entre consultas de estado mientras la evaluación está en curso (ms). */
export const POLL_BACKOFF_MS = [2000, 4000, 8000, 15000];

export function nextPollDelay(attempt: number): number {
  return POLL_BACKOFF_MS[Math.min(Math.max(attempt, 0), POLL_BACKOFF_MS.length - 1)];
}

/** Reintenta las fuentes faltantes de la MISMA evaluación (CA-25.06). */
export function retryEvaluation<T>(slug: string, evaluationId: string): Promise<T> {
  return institutionApi<T>(
    `/tenants/${encodeURIComponent(slug)}/evaluations/${encodeURIComponent(evaluationId)}/retry`,
    { body: {} },
  );
}

/** Clave de idempotencia por intento lógico de creación (CA-25.01). */
export function newIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Texto para la región aria-live: cambia solo cuando cambia el estado persistido. */
export function statusAnnouncement(status: string, tracking?: EvaluationTracking): string {
  switch (status) {
    case "DRAFT":
      return "La evaluación está pendiente de iniciar.";
    case "IN_PROGRESS":
      return tracking === "PROGRESS_STALLED"
        ? "La consulta se está demorando. Puedes actualizar el estado."
        : "Consultando fuentes financieras.";
    case "COMPLETED":
      return "La evaluación se completó.";
    case "INCOMPLETE":
      return "Resultado parcial: faltó información de una fuente.";
    case "FAILED":
      return "La consulta no se pudo completar por ahora.";
    default:
      return "";
  }
}

export function formatAsOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("es-BO");
}
