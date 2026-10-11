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

export abstract class BankMockSource {
  abstract status(tenantId: string): Promise<SourceStatus>;
  abstract enable(tenantId: string): Promise<boolean>;
  abstract query(tenantId: string, documentNumber: string): Promise<SourceQueryResult>;
}

export abstract class BureauMockSource {
  abstract status(tenantId: string): Promise<SourceStatus>;
  abstract enable(tenantId: string, enabled?: boolean): Promise<boolean>;
}

