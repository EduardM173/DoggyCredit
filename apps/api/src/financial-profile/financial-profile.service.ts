import { Injectable } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import type { NormalizedFinancialData } from "../financial-integrations/public.js";
import {
  FinancialProfileCalculator,
  type CalculatedProfileIndicators,
  type PersistedFinancialProfile,
} from "./public.js";

const CURRENT_PROFILE_VERSION = "1.0.0";

@Injectable()
export class FinancialProfileService extends FinancialProfileCalculator {
  constructor(private readonly db: DatabaseUnitOfWork) {
    super();
  }

  calculate(data: NormalizedFinancialData | null): CalculatedProfileIndicators {
    if (!data) {
      return {
        averageMonthlyIncome: null,
        averageMonthlyExpenses: null,
        disposableIncome: null,
        totalDebt: null,
        activeCredits: null,
        debtToIncome: null,
        hasRecentArrears: null,
        completeness: 0,
        profileVersion: CURRENT_PROFILE_VERSION,
      };
    }

    // 1. Average Monthly Income
    let averageMonthlyIncome: number | null = null;
    if (data.accounts && data.accounts.length > 0) {
      const totalInflow = data.accounts.reduce(
        (sum, acc) => sum + (acc.averageMonthlyInflow || 0),
        0,
      );
      averageMonthlyIncome = totalInflow > 0 ? Number(totalInflow.toFixed(2)) : null;
    }

    // 2. Average Monthly Expenses
    let averageMonthlyExpenses: number | null = null;
    if (data.accounts && data.accounts.length > 0) {
      const totalOutflow = data.accounts.reduce(
        (sum, acc) => sum + (acc.averageMonthlyOutflow || 0),
        0,
      );
      averageMonthlyExpenses = totalOutflow > 0 ? Number(totalOutflow.toFixed(2)) : null;
    }

    // 3. Disposable Income (Income - Expenses)
    let disposableIncome: number | null = null;
    if (averageMonthlyIncome !== null && averageMonthlyExpenses !== null) {
      disposableIncome = Number(
        (averageMonthlyIncome - averageMonthlyExpenses).toFixed(2),
      );
    }

    // 4. Total Debt & 5. Active Credits
    let totalDebt: number | null = null;
    let activeCredits: number | null = null;
    let totalMonthlyDebtService = 0;
    let hasRecentArrears: boolean | null = null;

    if (data.loans !== undefined && data.loans !== null) {
      const activeLoans = data.loans.filter((loan) => loan.status === "ACTIVE");
      activeCredits = activeLoans.length;
      totalDebt = Number(
        activeLoans.reduce((sum, loan) => sum + (loan.outstandingBalance || 0), 0).toFixed(2),
      );
      totalMonthlyDebtService = activeLoans.reduce(
        (sum, loan) => sum + (loan.monthlyInstallment || 0),
        0,
      );
      hasRecentArrears = data.loans.some(
        (loan) => loan.daysPastDue > 0 || loan.status === "DELINQUENT",
      );
    }

    // 6. Debt To Income (DTI): monthly installments / income
    let debtToIncome: number | null = null;
    if (averageMonthlyIncome !== null && averageMonthlyIncome > 0 && activeCredits !== null) {
      if (activeCredits === 0) {
        debtToIncome = 0;
      } else {
        debtToIncome = Number((totalMonthlyDebtService / averageMonthlyIncome).toFixed(4));
      }
    }

    // 7. Completeness: proportion of the 7 indicators that are not null
    const keyMetrics = [
      averageMonthlyIncome,
      averageMonthlyExpenses,
      disposableIncome,
      totalDebt,
      activeCredits,
      debtToIncome,
      hasRecentArrears,
    ];
    const nonNullCount = keyMetrics.filter((m) => m !== null).length;
    const completeness = Number((nonNullCount / keyMetrics.length).toFixed(4));

    return {
      averageMonthlyIncome,
      averageMonthlyExpenses,
      disposableIncome,
      totalDebt,
      activeCredits,
      debtToIncome,
      hasRecentArrears,
      completeness,
      profileVersion: CURRENT_PROFILE_VERSION,
    };
  }

  async saveProfile(
    tenantId: string,
    evaluationId: string,
    sourceResultId: string,
    indicators: CalculatedProfileIndicators,
  ): Promise<PersistedFinancialProfile> {
    const profile = await this.db.client.financialProfile.upsert({
      where: {
        tenantId_evaluationId: {
          tenantId,
          evaluationId,
        },
      },
      update: {
        averageMonthlyIncome: indicators.averageMonthlyIncome,
        averageMonthlyExpenses: indicators.averageMonthlyExpenses,
        disposableIncome: indicators.disposableIncome,
        totalDebt: indicators.totalDebt,
        activeCredits: indicators.activeCredits,
        debtToIncome: indicators.debtToIncome,
        hasRecentArrears: indicators.hasRecentArrears,
        completeness: indicators.completeness,
        profileVersion: indicators.profileVersion,
        calculatedAt: new Date(),
      },
      create: {
        tenantId,
        evaluationId,
        averageMonthlyIncome: indicators.averageMonthlyIncome,
        averageMonthlyExpenses: indicators.averageMonthlyExpenses,
        disposableIncome: indicators.disposableIncome,
        totalDebt: indicators.totalDebt,
        activeCredits: indicators.activeCredits,
        debtToIncome: indicators.debtToIncome,
        hasRecentArrears: indicators.hasRecentArrears,
        completeness: indicators.completeness,
        profileVersion: indicators.profileVersion,
      },
    });

    await this.db.client.profileSource.upsert({
      where: {
        tenantId_profileId_sourceResultId: {
          tenantId,
          profileId: profile.id,
          sourceResultId,
        },
      },
      update: {},
      create: {
        tenantId,
        profileId: profile.id,
        sourceResultId,
      },
    });

    return {
      id: profile.id,
      tenantId: profile.tenantId,
      evaluationId: profile.evaluationId,
      averageMonthlyIncome: profile.averageMonthlyIncome
        ? Number(profile.averageMonthlyIncome)
        : null,
      averageMonthlyExpenses: profile.averageMonthlyExpenses
        ? Number(profile.averageMonthlyExpenses)
        : null,
      disposableIncome: profile.disposableIncome
        ? Number(profile.disposableIncome)
        : null,
      totalDebt: profile.totalDebt ? Number(profile.totalDebt) : null,
      activeCredits: profile.activeCredits,
      debtToIncome: profile.debtToIncome ? Number(profile.debtToIncome) : null,
      hasRecentArrears: profile.hasRecentArrears,
      completeness: Number(profile.completeness),
      profileVersion: profile.profileVersion,
      calculatedAt: profile.calculatedAt,
    };
  }
}
