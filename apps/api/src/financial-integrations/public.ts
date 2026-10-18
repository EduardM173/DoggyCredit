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

export function sourceCoversSubject(
  providerCode: SourceProviderCode,
  subject: SourceSubjectType,
): boolean {
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

export {
  BureauMockSource,
  BureauMockSourceService,
} from "./bureau-mock-source.service.js";


