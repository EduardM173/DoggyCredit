export type Membership = { tenant: { name: string; slug: string }; role: string };
export type InstitutionMe = {
  user: { id: string; fullName: string; email: string };
  activeMemberships: Membership[];
};
export type LoginResolution =
  | { authenticated: true; resolution: "NO_ACTIVE_TENANT" }
  | { authenticated: true; resolution: "SINGLE_TENANT"; tenant: Membership["tenant"] }
  | { authenticated: true; resolution: "MULTIPLE_TENANTS"; tenants: Membership["tenant"][] };
export type InstitutionHome = {
  user: { name: string };
  tenant: { name: string; slug: string; taxId: string; type: string };
  membership: { role: string; status: "ACTIVE" };
  source: { available: boolean; enabled: boolean };
  products: {
    id: string;
    name: string;
    category: string;
    applicantScope: string;
    minAmount: string;
    maxAmount: string;
    purposes: string[];
    selected: boolean;
  }[];
  steps: { institution: boolean; source: boolean; products: boolean };
  completed: number;
  percentage: number;
  ready: boolean;
};

export type EvaluationItem = {
  id: string;
  tenantId: string;
  clientId: string;
  clientName: string;
  documentType: string;
  documentNumber: string;
  purpose: string;
  requestedAmount: number;
  status: "DRAFT" | "IN_PROGRESS" | "COMPLETED" | "INCOMPLETE" | "FAILED";
  consentGivenAt: string | null;
  applicantSnapshot: unknown;
  ruleVersion: string | null;
  createdAt: string;
};

export type FinancialProfileDto = {
  id: string;
  averageMonthlyIncome: number | null;
  averageMonthlyExpenses: number | null;
  disposableIncome: number | null;
  totalDebt: number | null;
  activeCredits: number | null;
  debtToIncome: number | null;
  hasRecentArrears: boolean | null;
  completeness: number;
  profileVersion: string;
  calculatedAt: string;
};

export type EvaluationSourceResultDto = {
  id: string;
  providerId: string;
  status: "SUCCESS" | "NO_DATA" | "UNAVAILABLE" | "ERROR";
  attemptCount: number;
  externalReference: string | null;
  errorCode: string | null;
  requestedAt: string;
  respondedAt: string | null;
};

export type EvaluationDetailItem = EvaluationItem & {
  failureCode: string | null;
  failureMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  profile: FinancialProfileDto | null;
  sourceResults: EvaluationSourceResultDto[];
};

export type ClientSearchResult = {
  id: string;
  name: string;
  documentType: string;
  documentNumber: string;
  type: string;
  economicActivity: string | null;
} | null;

export type CreateEvaluationPayload = {
  documentType: "CI" | "NIT" | "PASSPORT" | "OTHER";
  documentNumber: string;
  name: string;
  purpose: "WORKING_CAPITAL" | "GREEN_PROJECT" | "BUSINESS_INVESTMENT" | "EQUIPMENT" | "OTHER";
  requestedAmount: number;
  consentGiven: boolean;
  idempotencyKey?: string;
};

export async function fetchEvaluation(tenantSlug: string, evaluationId: string): Promise<EvaluationDetailItem> {
  return institutionApi<EvaluationDetailItem>(`/tenants/${encodeURIComponent(tenantSlug)}/evaluations/${encodeURIComponent(evaluationId)}`);
}

export async function processEvaluation(tenantSlug: string, evaluationId: string): Promise<EvaluationDetailItem> {
  return institutionApi<EvaluationDetailItem>(`/tenants/${encodeURIComponent(tenantSlug)}/evaluations/${encodeURIComponent(evaluationId)}/process`, {
    body: {},
  });
}

export class InstitutionError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function institutionApi<T>(path: string, options: { body?: object; signal?: AbortSignal } = {}) {
  const base = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
  const response = await fetch(`${base}/institution${path}`, {
    credentials: "include",
    cache: "no-store",
    signal: options.signal,
    ...(options.body !== undefined
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-DoggyCredit-Institution": "1" },
          body: JSON.stringify(options.body),
        }
      : {}),
  });
  if (!response.ok) {
    const message =
      response.status === 401
        ? path === "/auth/login"
          ? "Correo o contraseña incorrectos."
          : "Tu sesión terminó. Inicia sesión nuevamente."
        : response.status === 403
          ? "No tienes acceso a este espacio institucional."
          : response.status === 404
            ? "La institución no existe."
            : response.status === 429
              ? "Demasiados intentos. Intenta nuevamente en unos minutos."
              : "No se pudo completar la operación. Intenta nuevamente.";
    throw new InstitutionError(response.status, message);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export function authorizedReturnTo(value: string | null, memberships: Membership[]) {
  if (!value || !/^\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) return null;
  return memberships.some((item) => `/${item.tenant.slug}` === value) ? value : null;
}

export function destination(me: InstitutionMe, returnTo: string | null) {
  const allowed = authorizedReturnTo(returnTo, me.activeMemberships);
  if (allowed) return allowed;
  if (me.activeMemberships.length === 1) return `/${me.activeMemberships[0].tenant.slug}`;
  return "/elegir-institucion";
}
