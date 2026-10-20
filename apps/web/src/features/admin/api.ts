export type Status = "EMAIL_PENDING" | "PENDING_REVIEW" | "APPROVED" | "REJECTED";
export const statusLabels: Record<Status, string> = {
  EMAIL_PENDING: "Correo pendiente",
  PENDING_REVIEW: "En revisión",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
};
export interface Session {
  user: { id: string; fullName: string; email: string; platformRole: string };
  expiresAt: string;
}
export interface ReviewItem {
  id: string;
  institutionName: string;
  taxId: string;
  contactEmail: string;
  planInterest: string | null;
  status: Status;
  createdAt: string;
}
export interface ReviewDetail extends ReviewItem {
  institutionType: string;
  contactName: string;
  contactRole: string;
  contactPhone: string;
  emailVerifiedAt: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  reviewer: { fullName: string } | null;
}
export interface ReviewList {
  items: ReviewItem[];
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
}
/** HU-30: habilitación global, salud observada y habilitación por instituciones son tres hechos distintos. */
export interface ProviderAdminView {
  code: "BANK_MOCK" | "BUREAU_MOCK";
  name: string;
  kind: "BANK" | "CREDIT_BUREAU";
  description: string;
  registered: boolean;
  coverage: { subjectTypes: ("PERSON" | "COMPANY")[] };
  global: { enabled: boolean; changedAt: string | null };
  health: { status: "ACTIVE" | "DEGRADED" | "INACTIVE" };
  tenants: { enabled: number };
  acceptsNewQueries: boolean;
  simulationScenarios?: { status: string; documentEnding: string; description: string }[];
}

/** HU-23: salud observada de integraciones (vista del operador). */
export type IntegrationHealthState =
  | "SIN_SENAL_RECIENTE"
  | "OPERATIVO_OBSERVADO"
  | "DEGRADADO_OBSERVADO"
  | "ERROR_MONITOREO";
export interface IntegrationListItem {
  code: string;
  name: string;
  globallyEnabled: boolean;
  health: {
    state: IntegrationHealthState;
    lastSignalAt: string | null;
    confidence?: string;
  };
  tenants: {
    enabled: number;
    affected: { known: boolean; count: number | null };
  };
}
export interface IntegrationDetail extends Omit<IntegrationListItem, "health"> {
  health: {
    state: IntegrationHealthState;
    lastSignalAt: string | null;
    confidence?: string;
    windowStart?: string;
    windowEnd?: string;
    label: string;
    explanation: string;
    nextStep: string;
  };
  episode: { episodeId: string; startedAt: string } | null;
  protection: { label: string };
  affectedTenants: { name: string }[];
  advanced: {
    breakerState: string;
    scope: string;
    reasonCode: string;
    samples: number;
    failures: number;
  };
}

export class AdminError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
async function fetchAdmin(url: string, init: RequestInit, retryable: boolean): Promise<Response> {
  const delays = retryable ? [300, 700, 1500, 3000] : [];
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, init);
      if (![502, 503, 504].includes(response.status) || attempt >= delays.length) return response;
    } catch (error) {
      if (!retryable || init.signal?.aborted || attempt >= delays.length) throw error;
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        init.signal?.removeEventListener("abort", onAbort);
        resolve();
      }, delays[attempt]);
      function onAbort() {
        clearTimeout(timeout);
        reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError"));
      }
      init.signal?.addEventListener("abort", onAbort, { once: true });
      if (init.signal?.aborted) onAbort();
    });
  }
}
export async function adminApi<T>(
  path: string,
  options: { body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const base = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
  const response = await fetchAdmin(
    `${base}/admin${path}`,
    {
      credentials: "include",
      cache: "no-store",
      signal: options.signal,
      ...(options.body !== undefined
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-DoggyCredit-Admin": "1" },
            body: JSON.stringify(options.body),
          }
        : {}),
    },
    path === "/auth/session" && options.body === undefined,
  );
  if (!response.ok) {
    let message = "No se pudo completar la operación. Intenta nuevamente.";
    if (response.status === 401)
      message =
        path === "/auth/login" ? "Credenciales incorrectas." : "Tu sesión terminó. Inicia sesión nuevamente.";
    if (response.status === 403) message = "No tienes autorización para esta operación.";
    if (response.status === 404) message = path.startsWith("/platform/team") ? "El operador no existe." : "La solicitud no existe.";
    if (response.status === 409)
      message = path.startsWith("/platform/team")
        ? "El estado del operador cambió. Actualiza el equipo y vuelve a intentar."
        : path.startsWith("/contractings/")
        ? "El estado de esta contratación cambió. Actualiza la lista antes de reintentar."
        : "La solicitud cambió o ya fue resuelta. Se ha actualizado el detalle.";
    if (response.status === 429) message = "Demasiados intentos. Intenta nuevamente en unos minutos.";
    throw new AdminError(response.status, message);
  }
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}
export const displayDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("es-BO", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(
        new Date(value),
      )
    : "No registrada";
