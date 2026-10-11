export type Membership = { tenant: { name: string; slug: string }; role: string };
export type InstitutionMe = {
  user: { id: string; fullName: string; email: string };
  activeMemberships: Membership[];
};
export type LoginResolution =
  | { authenticated: true; resolution: "NO_ACTIVE_TENANT" }
  | { authenticated: true; resolution: "SINGLE_TENANT"; tenant: Membership["tenant"] }
  | { authenticated: true; resolution: "MULTIPLE_TENANTS"; tenants: Membership["tenant"][] };
export type SourceItem = {
  code: string;
  name: string;
  kind: string;
  description: string;
  purpose: string;
  coverage: string;
  available: boolean;
  enabled: boolean;
  healthStatus: "ACTIVE" | "DEGRADED" | "INACTIVE" | string;
};

export type InstitutionHome = {
  user: { name: string };
  tenant: { name: string; slug: string; taxId: string; type: string };
  membership: { role: string; status: "ACTIVE" };
  source: { available: boolean; enabled: boolean };
  sources?: SourceItem[];
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

export type IndicatorProvenance = "BANK_MOCK" | "BUREAU_MOCK" | "CONSOLIDATED" | "NOT_AVAILABLE";

export type ProfileIndicatorProvenanceDto = {
  averageMonthlyIncome: IndicatorProvenance;
  averageMonthlyExpenses: IndicatorProvenance;
  disposableIncome: IndicatorProvenance;
  totalDebt: IndicatorProvenance;
  activeCredits: IndicatorProvenance;
  debtToIncome: IndicatorProvenance;
  hasRecentArrears: IndicatorProvenance;
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
  indicatorProvenance?: ProfileIndicatorProvenanceDto | null;
};

export type EvaluationSourceResultDto = {
  id: string;
  providerId: string;
  providerCode?: string;
  providerName?: string;
  status: "SUCCESS" | "NO_DATA" | "UNAVAILABLE" | "ERROR";
  attemptCount: number;
  externalReference: string | null;
  errorCode: string | null;
  requestedAt: string;
  respondedAt: string | null;
};

export type RuleEvaluationStatus = "PASSED" | "FAILED" | "NOT_EVALUABLE";

export type RecommendationReasonDto = {
  code: string;
  message: string;
  passed: boolean;
  status?: RuleEvaluationStatus;
};

export type ProductRecommendationDto = {
  id: string;
  productId: string;
  productName: string;
  category: string;
  outcome: "RECOMMENDED" | "NOT_COMPATIBLE" | "NOT_EVALUABLE";
  compatibilityStatus?: "COMPATIBLE" | "INCOMPATIBLE" | "NOT_EVALUABLE";
  ruleVersion: string;
  minAmount: number;
  maxAmount: number;
  evaluatedAt: string;
  reasons: RecommendationReasonDto[];
};

export type EvaluationDetailItem = EvaluationItem & {
  failureCode: string | null;
  failureMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  profile: FinancialProfileDto | null;
  sourceResults: EvaluationSourceResultDto[];
  recommendations: ProductRecommendationDto[];
};

export type ClientSearchResult = {
  id: string;
  name: string;
  documentType: string;
  documentNumber: string;
  type: string;
  economicActivity: string | null;
} | null;

export type EvaluationReadiness = {
  ready: boolean;
  completed: number;
  percentage: number;
  steps: { institution: boolean; source: boolean; products: boolean };
  tenantName: string;
  supportedApplicantTypes?: {
    PERSON: { supported: boolean; reason?: string };
    COMPANY: { supported: boolean; reason?: string };
  };
};

export type CreateEvaluationPayload = {
  clientType?: "PERSON" | "COMPANY";
  documentType: "CI" | "NIT" | "PASSPORT" | "OTHER";
  documentNumber: string;
  name: string;
  economicActivity?: string;
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

export type ProductCategory = "MICRO_CREDIT" | "GREEN_CREDIT" | "SME_CREDIT" | "OTHER";
export type ApplicantScope = "PERSON" | "COMPANY" | "BOTH";
export type CreditPurpose =
  | "WORKING_CAPITAL"
  | "GREEN_PROJECT"
  | "BUSINESS_INVESTMENT"
  | "EQUIPMENT"
  | "OTHER";

export interface ProductCatalogItem {
  id: string;
  tenantId: string;
  name: string;
  category: ProductCategory;
  applicantScope: ApplicantScope;
  minAmount: number;
  maxAmount: number;
  maxDebtToIncome: number | null;
  minMonthlyDisposableIncome: number | null;
  allowsRecentArrears: boolean;
  active: boolean;
  purposes: CreditPurpose[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateProductPayload {
  name: string;
  category: ProductCategory;
  applicantScope: ApplicantScope;
  purposes: CreditPurpose[];
  minAmount: number;
  maxAmount: number;
  maxDebtToIncome?: number | null;
  minMonthlyDisposableIncome?: number | null;
  allowsRecentArrears?: boolean;
  active?: boolean;
}

export interface UpdateProductPayload {
  name?: string;
  category?: ProductCategory;
  applicantScope?: ApplicantScope;
  purposes?: CreditPurpose[];
  minAmount?: number;
  maxAmount?: number;
  maxDebtToIncome?: number | null;
  minMonthlyDisposableIncome?: number | null;
  allowsRecentArrears?: boolean;
  active?: boolean;
}

export interface DeactivationImpactResponse {
  isLastActive: boolean;
  scope: ApplicantScope | null;
  warningMessage?: string;
}

export class InstitutionError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = "InstitutionError";
  }
}

export async function institutionApi<T>(
  path: string,
  options: {
    body?: object;
    signal?: AbortSignal;
    method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  } = {},
) {
  const base = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
  const method = options.method ?? (options.body !== undefined ? "POST" : "GET");
  const response = await fetch(`${base}/institution${path}`, {
    method,
    credentials: "include",
    cache: "no-store",
    signal: options.signal,
    ...(options.body !== undefined
      ? {
          headers: { "Content-Type": "application/json", "X-DoggyCredit-Institution": "1" },
          body: JSON.stringify(options.body),
        }
      : {}),
  });

  if (!response.ok) {
    const errorJson = await response.json().catch(() => null);
    const serverMessage =
      errorJson && typeof errorJson === "object"
        ? (errorJson.message as string) || (errorJson.error as string)
        : null;
    const serverCode =
      errorJson && typeof errorJson === "object" ? (errorJson.code as string) : undefined;

    const message =
      serverMessage ||
      (response.status === 401
        ? path === "/auth/login"
          ? "Correo o contraseña incorrectos."
          : "Tu sesión terminó. Inicia sesión nuevamente."
        : response.status === 403
          ? "No tienes acceso a este espacio institucional."
          : response.status === 404
            ? "El recurso solicitado no existe."
            : response.status === 409
              ? "Conflicto con los datos o estado de la institución."
              : response.status === 429
                ? "Demasiados intentos. Intenta nuevamente en unos minutos."
                : "No se pudo completar la operación. Intenta nuevamente.");

    throw new InstitutionError(response.status, message, serverCode, errorJson);
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
