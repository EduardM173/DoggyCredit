import type { NormalizedFinancialData } from "../financial-integrations/public.js";

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

export interface PersistedFinancialProfile extends CalculatedProfileIndicators {
  id: string;
  tenantId: string;
  evaluationId: string;
  calculatedAt: Date;
}

export abstract class FinancialProfileCalculator {
  abstract calculate(data: NormalizedFinancialData | null): CalculatedProfileIndicators;
  abstract saveProfile(
    tenantId: string,
    evaluationId: string,
    sourceResultId: string,
    indicators: CalculatedProfileIndicators,
  ): Promise<PersistedFinancialProfile>;
}
