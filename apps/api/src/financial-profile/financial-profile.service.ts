import { Injectable } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import type { NormalizedFinancialData } from "../financial-integrations/public.js";
import {
  FinancialProfileCalculator,
  type CalculatedProfileIndicators,
  type ConsolidateProfileInput,
  type ConsolidatedProfileResult,
  type IndicatorProvenance,
  type PersistedFinancialProfile,
  type ProfileIndicatorProvenance,
} from "./public.js";

const CURRENT_PROFILE_VERSION = "1.0.0";

@Injectable()
export class FinancialProfileService extends FinancialProfileCalculator {
  constructor(private readonly db: DatabaseUnitOfWork) {
    super();
  }

  calculate(data: NormalizedFinancialData | null): CalculatedProfileIndicators {
    return this.consolidate({ bankData: data, bureauData: null }).indicators;
  }

  consolidate(input: ConsolidateProfileInput): ConsolidatedProfileResult {
    const { bankData, bureauData } = input;

    // 1. Average Monthly Income (strictly from Bank Mock)
    let averageMonthlyIncome: number | null = null;
    let incomeProv: IndicatorProvenance = "NOT_AVAILABLE";
    if (bankData?.accounts && bankData.accounts.length > 0) {
      const totalInflow = bankData.accounts.reduce(
        (sum, acc) => sum + (acc.averageMonthlyInflow || 0),
        0,
      );
      if (totalInflow > 0) {
        averageMonthlyIncome = Number(totalInflow.toFixed(2));
        incomeProv = "BANK_MOCK";
      }
    }

    // 2. Average Monthly Expenses (strictly from Bank Mock)
    let averageMonthlyExpenses: number | null = null;
    let expenseProv: IndicatorProvenance = "NOT_AVAILABLE";
    if (bankData?.accounts && bankData.accounts.length > 0) {
      const totalOutflow = bankData.accounts.reduce(
        (sum, acc) => sum + (acc.averageMonthlyOutflow || 0),
        0,
      );
      if (totalOutflow > 0) {
        averageMonthlyExpenses = Number(totalOutflow.toFixed(2));
        expenseProv = "BANK_MOCK";
      }
    }

    // 3. Disposable Income (Income - Expenses)
    let disposableIncome: number | null = null;
    let disposableProv: IndicatorProvenance = "NOT_AVAILABLE";
    if (averageMonthlyIncome !== null && averageMonthlyExpenses !== null) {
      disposableIncome = Number(
        (averageMonthlyIncome - averageMonthlyExpenses).toFixed(2),
      );
      disposableProv = "BANK_MOCK";
    }

    // 4. Extract Bank Loan Metrics
    let bankDebt: number | null = null;
    let bankActiveCredits: number | null = null;
    let bankMonthlyInstallments = 0;
    let bankHasArrears: boolean | null = null;
    const bankHasLoanData = bankData?.loans !== undefined && bankData?.loans !== null;

    if (bankHasLoanData && bankData?.loans) {
      const activeLoans = bankData.loans.filter((loan) => loan.status === "ACTIVE");
      bankActiveCredits = activeLoans.length;
      bankDebt = Number(
        activeLoans.reduce((sum, loan) => sum + (loan.outstandingBalance || 0), 0).toFixed(2),
      );
      bankMonthlyInstallments = activeLoans.reduce(
        (sum, loan) => sum + (loan.monthlyInstallment || 0),
        0,
      );
      bankHasArrears = bankData.loans.some(
        (loan) => loan.daysPastDue > 0 || loan.status === "DELINQUENT",
      );
    }

    // 5. Extract Bureau Metrics
    let bureauDebt: number | null = null;
    let bureauActiveCredits: number | null = null;
    let bureauMonthlyInstallments = 0;
    let bureauHasArrears: boolean | null = null;
    const bureauHasData = bureauData !== null && bureauData !== undefined;

    if (bureauHasData) {
      bureauDebt = bureauData.totalSystemDebt;
      bureauActiveCredits = bureauData.activeCreditsCount;
      bureauMonthlyInstallments =
        bureauData.monthlyInstallmentsTotal ??
        (bureauData.loans ?? [])
          .filter((l) => l.status === "ACTIVE" || l.status === "DELINQUENT")
          .reduce((sum, l) => sum + (l.monthlyInstallment || 0), 0);
      bureauHasArrears = bureauData.hasRecentArrears;
    }

    // 6. Consolidate Total Debt (S3-RF-03 discrepancy resolution: Math.max)
    let totalDebt: number | null = null;
    let totalDebtProv: IndicatorProvenance = "NOT_AVAILABLE";

    if (bankDebt !== null && bureauDebt !== null) {
      totalDebt = Number(Math.max(bankDebt, bureauDebt).toFixed(2));
      totalDebtProv = "CONSOLIDATED";
    } else if (bureauDebt !== null) {
      totalDebt = Number(bureauDebt.toFixed(2));
      totalDebtProv = "BUREAU_MOCK";
    } else if (bankDebt !== null) {
      totalDebt = Number(bankDebt.toFixed(2));
      totalDebtProv = "BANK_MOCK";
    }

    // 7. Consolidate Active Credits
    let activeCredits: number | null = null;
    let activeCreditsProv: IndicatorProvenance = "NOT_AVAILABLE";

    if (bankActiveCredits !== null && bureauActiveCredits !== null) {
      activeCredits = Math.max(bankActiveCredits, bureauActiveCredits);
      activeCreditsProv = "CONSOLIDATED";
    } else if (bureauActiveCredits !== null) {
      activeCredits = bureauActiveCredits;
      activeCreditsProv = "BUREAU_MOCK";
    } else if (bankActiveCredits !== null) {
      activeCredits = bankActiveCredits;
      activeCreditsProv = "BANK_MOCK";
    }

    // 8. Consolidate Debt To Income (DTI)
    let debtToIncome: number | null = null;
    let debtToIncomeProv: IndicatorProvenance = "NOT_AVAILABLE";

    if (averageMonthlyIncome !== null && averageMonthlyIncome > 0 && activeCredits !== null) {
      if (activeCredits === 0) {
        debtToIncome = 0;
        debtToIncomeProv =
          bankActiveCredits !== null && bureauActiveCredits !== null
            ? "CONSOLIDATED"
            : bureauActiveCredits !== null
              ? "BUREAU_MOCK"
              : "BANK_MOCK";
      } else {
        const totalInstallments = Math.max(bankMonthlyInstallments, bureauMonthlyInstallments);
        debtToIncome = Number((totalInstallments / averageMonthlyIncome).toFixed(4));
        debtToIncomeProv = bureauHasData ? "CONSOLIDATED" : "BANK_MOCK";
      }
    }

    // 9. Consolidate Recent Arrears
    let hasRecentArrears: boolean | null = null;
    let arrearsProv: IndicatorProvenance = "NOT_AVAILABLE";

    if (bankHasArrears !== null && bureauHasArrears !== null) {
      hasRecentArrears = bankHasArrears || bureauHasArrears;
      arrearsProv = "CONSOLIDATED";
    } else if (bureauHasArrears !== null) {
      hasRecentArrears = bureauHasArrears;
      arrearsProv = "BUREAU_MOCK";
    } else if (bankHasArrears !== null) {
      hasRecentArrears = bankHasArrears;
      arrearsProv = "BANK_MOCK";
    }

    // 10. Completeness (fraction of 7 core indicators non-null)
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

    const indicators: CalculatedProfileIndicators = {
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

    const provenance: ProfileIndicatorProvenance = {
      averageMonthlyIncome: incomeProv,
      averageMonthlyExpenses: expenseProv,
      disposableIncome: disposableProv,
      totalDebt: totalDebtProv,
      activeCredits: activeCreditsProv,
      debtToIncome: debtToIncomeProv,
      hasRecentArrears: arrearsProv,
    };

    return { indicators, provenance };
  }

  async saveProfile(
    tenantId: string,
    evaluationId: string,
    sourceResultIds: string | string[],
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

    const ids = Array.isArray(sourceResultIds) ? sourceResultIds : [sourceResultIds];
    for (const sourceResultId of ids) {
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
    }

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

