export interface BankAccountRecord {
  accountNumberMasked: string;
  accountType: "SAVINGS" | "CHECKING";
  currency: string;
  currentBalance: number;
  averageMonthlyInflow: number;
  averageMonthlyOutflow: number;
}

export interface BankLoanRecord {
  loanId: string;
  loanType: "CONSUMER" | "MORTGAGE" | "COMMERCIAL" | "MICRO";
  originalAmount: number;
  outstandingBalance: number;
  monthlyInstallment: number;
  status: "ACTIVE" | "PAID" | "DELINQUENT";
  daysPastDue: number;
}

export interface NormalizedFinancialData {
  documentNumber: string;
  accounts: BankAccountRecord[];
  loans: BankLoanRecord[];
  reportedAt: string;
  currency: string;
}

export type SourceQueryResult =
  | {
      status: "SUCCESS";
      data: NormalizedFinancialData;
      externalReference: string;
      providerId: string;
    }
  | {
      status: "NO_DATA";
      message: string;
      externalReference?: string;
      providerId: string;
    }
  | {
      status: "UNAVAILABLE";
      message: string;
      errorCode: string;
      retryable: true;
      providerId: string;
    }
  | {
      status: "ERROR";
      message: string;
      errorCode: string;
      retryable: true;
      providerId: string;
    };

export interface SourceStatus {
  available: boolean;
  enabled: boolean;
  healthStatus?: "ACTIVE" | "DEGRADED" | "INACTIVE";
  /** HU-30: habilitación global de la plataforma (hecho distinto de la salud y de la habilitación del tenant). */
  globallyEnabled?: boolean;
}

/** Tipo de sujeto que una fuente puede consultar (S4-HF-07). */
export type SourceSubjectType = "PERSON" | "COMPANY";

export type SourceProviderCode = "BANK_MOCK" | "BUREAU_MOCK";

/**
 * Cobertura real de cada fuente simulada por tipo de sujeto. Es la única
 * declaración: la preparación, la creación del borrador y el procesamiento
 * consultan esta tabla en lugar de suponer que toda fuente cubre todo.
 * El Buró simulado solo conoce personas; el Banco simulado cubre personas y
 * empresas (NIT).
 */
export const SOURCE_COVERAGE: Readonly<Record<SourceProviderCode, readonly SourceSubjectType[]>> = {
  BANK_MOCK: ["PERSON", "COMPANY"],
  BUREAU_MOCK: ["PERSON"],
};

/** Catálogo de los proveedores simulados del MVP (HU-30, CA-30.01). Una sola declaración. */
export const PROVIDER_CATALOG: Readonly<
  Record<SourceProviderCode, { name: string; kind: "BANK" | "CREDIT_BUREAU"; description: string }>
> = {
  BANK_MOCK: {
    name: "Fuente bancaria simulada",
    kind: "BANK",
    description: "Cuentas, balances, ingresos, egresos y créditos bancarios simulados.",
  },
  BUREAU_MOCK: {
    name: "Buró crediticio simulado",
    kind: "CREDIT_BUREAU",
    description: "Historial crediticio consolidado, deuda global y mora histórica simulados.",
  },
};

export const SOURCE_PROVIDER_CODES = Object.keys(PROVIDER_CATALOG) as SourceProviderCode[];

export function isSourceProviderCode(value: string): value is SourceProviderCode {
  return (SOURCE_PROVIDER_CODES as string[]).includes(value);
}

/**
 * Escenarios simulados predecibles por terminación del documento (HU-30, CA-30.06).
 * Solo describen el comportamiento determinista de los mocks; no existe ningún control
 * para editar registros ni forzar fallos en tiempo de ejecución.
 */
export const SIMULATION_SCENARIOS: readonly {
  status: SourceResultStatusName;
  documentEnding: string;
  description: string;
}[] = [
  { status: "UNAVAILABLE", documentEnding: "999", description: "Proveedor no disponible (reintentable)." },
  { status: "ERROR", documentEnding: "500", description: "Error del proveedor (reintentable)." },
  { status: "NO_DATA", documentEnding: "000", description: "Sin antecedentes para el solicitante." },
  { status: "SUCCESS", documentEnding: "cualquier otro", description: "Respuesta con datos." },
];

export type SourceResultStatusName = "SUCCESS" | "NO_DATA" | "UNAVAILABLE" | "ERROR";

/**
 * Un proveedor acepta consultas nuevas solo si la plataforma lo habilitó y su salud no es INACTIVE/DEGRADED
 * (comportamiento previo conservado). `globallyEnabled` ausente se interpreta como habilitado.
 */
export function providerAcceptsQueries(provider: { status: string; globallyEnabled?: boolean | null }) {
  return provider.globallyEnabled !== false && provider.status === "ACTIVE";
}

export function sourceCoversSubject(providerCode: SourceProviderCode, subject: SourceSubjectType): boolean {
  return SOURCE_COVERAGE[providerCode].includes(subject);
}

export abstract class BankMockSource {
  abstract status(tenantId: string): Promise<SourceStatus>;
  abstract enable(tenantId: string): Promise<boolean>;
  abstract query(
    tenantId: string,
    documentNumber: string,
    subjectType: SourceSubjectType,
  ): Promise<SourceQueryResult>;
}

export interface BureauLoanRecord {
  entityName: string;
  loanType: "CONSUMER" | "MORTGAGE" | "COMMERCIAL" | "MICRO" | "CREDIT_CARD";
  originalAmount: number;
  outstandingBalance: number;
  monthlyInstallment: number;
  status: "ACTIVE" | "PAID" | "DELINQUENT";
  daysPastDue: number;
}

export interface NormalizedBureauData {
  documentNumber: string;
  totalSystemDebt: number;
  activeCreditsCount: number;
  worstDelinquencyDays: number;
  hasRecentArrears: boolean;
  monthlyInstallmentsTotal?: number;
  loans: BureauLoanRecord[];
  reportedAt: string;
  currency: string;
}

export type BureauQueryResult =
  | {
      status: "SUCCESS";
      data: NormalizedBureauData;
      externalReference: string;
      providerId: string;
    }
  | {
      status: "NO_DATA";
      message: string;
      externalReference?: string;
      providerId: string;
    }
  | {
      status: "UNAVAILABLE";
      message: string;
      errorCode: string;
      retryable: true;
      providerId: string;
    }
  | {
      status: "ERROR";
      message: string;
      errorCode: string;
      retryable: true;
      providerId: string;
    };

export { BureauMockSource, BureauMockSourceService } from "./bureau-mock-source.service.js";
export {
  ProviderAdministrationService,
  type ProviderAdminView,
  type ProviderGlobalChange,
} from "./provider-administration.service.js";
