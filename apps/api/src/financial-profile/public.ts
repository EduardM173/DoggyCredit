import type {
  NormalizedFinancialData,
  NormalizedBureauData,
} from "../financial-integrations/public.js";

export type IndicatorProvenance = "BANK_MOCK" | "BUREAU_MOCK" | "CONSOLIDATED" | "NOT_AVAILABLE";

export interface ProfileIndicatorProvenance {
  averageMonthlyIncome: IndicatorProvenance;
  averageMonthlyExpenses: IndicatorProvenance;
  disposableIncome: IndicatorProvenance;
  totalDebt: IndicatorProvenance;
  activeCredits: IndicatorProvenance;
  debtToIncome: IndicatorProvenance;
  hasRecentArrears: IndicatorProvenance;
}

export interface CalculatedProfileIndicators {
  averageMonthlyIncome: number | null;
  averageMonthlyExpenses: number | null;
  disposableIncome: number | null;
  totalDebt: number | null;
  activeCredits: number | null;
  debtToIncome: number | null;
  hasRecentArrears: boolean | null;
  completeness: number;
  profileVersion: string;
}

export interface ConsolidateProfileInput {
  bankData: NormalizedFinancialData | null;
  bureauData: NormalizedBureauData | null;
}

export interface ConsolidatedProfileResult {
  indicators: CalculatedProfileIndicators;
  provenance: ProfileIndicatorProvenance;
}

export interface PersistedFinancialProfile extends CalculatedProfileIndicators {
  id: string;
  tenantId: string;
  evaluationId: string;
  calculatedAt: Date;
}

export abstract class FinancialProfileCalculator {
  abstract calculate(data: NormalizedFinancialData | null): CalculatedProfileIndicators;
  abstract consolidate(input: ConsolidateProfileInput): ConsolidatedProfileResult;
  abstract saveProfile(
    tenantId: string,
    evaluationId: string,
    sourceResultIds: string | string[],
    indicators: CalculatedProfileIndicators,
  ): Promise<PersistedFinancialProfile>;
}

