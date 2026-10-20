import { createHash } from "node:crypto";

/** PROPUESTO (RF-04 / RF-07): tope de reconsultas de la misma Evaluation. */
export const MAX_EVALUATION_RETRIES = 3;
/** PROPUESTO: TTL del lease de ejecución (OPS-04). */
export const EVALUATION_LEASE_MS = 60_000;

export type EvaluationTracking =
  | "ACTIVE_WAIT"
  | "PROGRESS_STALLED"
  | "PROVIDER_ISSUE"
  | "FAILED"
  | "FINAL";

const TRANSIENT_ERROR_CODES = new Set([
  "CIRCUIT_OPEN",
  "TIMEOUT",
  "PROVIDER_EXCEPTION",
  "BANK_UNAVAILABLE",
  "BUREAU_DOWN",
  "BUREAU_TIMEOUT",
  "SOURCE_UNAVAILABLE",
]);

export function fingerprintEvaluationRequest(payload: {
  clientType?: string;
  documentType: string;
  documentNumber: string;
  name: string;
  purpose: string;
  requestedAmount: number;
}): string {
  const canonical = JSON.stringify({
    clientType: payload.clientType ?? "PERSON",
    documentType: payload.documentType,
    documentNumber: payload.documentNumber.trim().toUpperCase(),
    name: payload.name.trim().toLowerCase(),
    purpose: payload.purpose,
    requestedAmount: payload.requestedAmount,
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 64);
}

/** La clave efectiva incluye el tenant: la misma clave de dos tenants nunca colisiona ni revela datos ajenos. */
export function effectiveIdempotencyKey(tenantId: string, clientKey: string): string {
  return createHash("sha256").update(`${tenantId}:${clientKey}`).digest("hex");
}

export function usageKeyForEvaluation(tenantId: string, evaluationId: string): string {
  return `usage:${tenantId}:${evaluationId}`.slice(0, 100);
}

export function isPrismaUniqueConflict(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2002",
  );
}

export function isRecordNotFound(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: string }).code === "P2025",
  );
}

export function isTransientSourceFailure(status: string, errorCode?: string | null): boolean {
  if (status === "UNAVAILABLE") return true;
  if (status === "ERROR") return !errorCode || TRANSIENT_ERROR_CODES.has(errorCode);
  return false;
}

export function sourceShouldBeRequeried(status: string, errorCode?: string | null): boolean {
  if (status === "SUCCESS" || status === "NO_DATA") return false;
  if (status === "UNAVAILABLE" || status === "ERROR") {
    return isTransientSourceFailure(status, errorCode);
  }
  return true;
}

export function sourceDisplayName(code?: string | null, name?: string | null): string {
  if (code === "BANK_MOCK") return "Banco Mock";
  if (code === "BUREAU_MOCK") return "Buró crediticio";
  return name || "Fuente financiera";
}

export function buildCoverageCopy(sources: Array<{
  providerCode?: string | null;
  providerName?: string | null;
  status: string;
}>): { achieved: string; missing: string; nextAction: string } {
  const achievedParts: string[] = [];
  const missingParts: string[] = [];
  let retryableMissing = false;
  let onlyNoData = true;

  for (const source of sources) {
    const label = sourceDisplayName(source.providerCode, source.providerName);
    if (source.status === "SUCCESS") {
      achievedParts.push(`${label} aportó datos`);
      onlyNoData = false;
    } else if (source.status === "NO_DATA") {
      missingParts.push(`${label} no tiene antecedentes para este solicitante`);
    } else {
      onlyNoData = false;
      retryableMissing = retryableMissing || isTransientSourceFailure(source.status);
      missingParts.push(`${label} no respondió por ahora`);
    }
  }

  const achieved = achievedParts.length > 0 ? `${achievedParts.join(". ")}.` : "Aún no hay datos de fuentes.";
  const missing =
    missingParts.length > 0 ? `${missingParts.join(". ")}.` : "No faltan consultas pendientes.";
  const nextAction = retryableMissing
    ? "Puedes reintentar esa consulta."
    : onlyNoData
      ? "No se puede completar con datos inventados. Si lo necesitas, inicia un estudio nuevo."
      : "Consulta el estado actual. No se promete un tiempo de restablecimiento.";

  return { achieved, missing, nextAction };
}

export function computeTracking(input: {
  status: string;
  leaseExpiresAt?: Date | null;
  retryable: boolean;
  now?: Date;
}): EvaluationTracking {
  const now = input.now ?? new Date();
  if (input.status === "IN_PROGRESS") {
    if (!input.leaseExpiresAt || input.leaseExpiresAt.getTime() <= now.getTime()) {
      return "PROGRESS_STALLED";
    }
    return "ACTIVE_WAIT";
  }
  if (input.status === "FAILED") return input.retryable ? "PROVIDER_ISSUE" : "FAILED";
  if (input.status === "INCOMPLETE") return input.retryable ? "PROVIDER_ISSUE" : "FINAL";
  return "FINAL";
}

export function evaluateRetryPolicy(input: {
  status: string;
  retryCount: number;
  failureCode?: string | null;
  sources: Array<{ status: string; errorCode?: string | null }>;
}): { allowed: boolean; reason: string; remainingAttempts: number } {
  const remainingAttempts = Math.max(0, MAX_EVALUATION_RETRIES - input.retryCount);

  if (input.status === "COMPLETED") {
    return {
      allowed: false,
      reason: "Esta evaluación ya está cerrada. Un estudio nuevo es otra evaluación.",
      remainingAttempts: 0,
    };
  }
  if (input.status === "DRAFT") {
    return { allowed: false, reason: "Todavía no se inició la consulta.", remainingAttempts };
  }
  if (input.status === "IN_PROGRESS") {
    return {
      allowed: false,
      reason: "La consulta sigue en curso. Espera el estado persistido.",
      remainingAttempts,
    };
  }
  if (remainingAttempts <= 0) {
    return {
      allowed: false,
      reason: "Se alcanzó el máximo de reconsultas de esta evaluación.",
      remainingAttempts: 0,
    };
  }

  const retryableSources = input.sources.filter((source) =>
    sourceShouldBeRequeried(source.status, source.errorCode),
  );
  if (retryableSources.length === 0 && !(input.status === "FAILED" && input.sources.length === 0)) {
    return {
      allowed: false,
      reason:
        input.status === "INCOMPLETE"
          ? "No hay fuentes reintentables. La ausencia de antecedentes no se consulta de nuevo."
          : "Esta interrupción no admite reintento sobre la misma evaluación.",
      remainingAttempts,
    };
  }

  return { allowed: true, reason: "Puedes reintentar la consulta faltante.", remainingAttempts };
}
