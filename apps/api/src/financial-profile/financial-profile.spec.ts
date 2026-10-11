import { jest } from "@jest/globals";
import { FinancialProfileService } from "./financial-profile.service.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import type { NormalizedFinancialData } from "../financial-integrations/public.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockFn = jest.Mock<any>;

describe("FinancialProfileService (S2-RF-03)", () => {
  let service: FinancialProfileService;
  let mockDb: {
    client: {
      financialProfile: {
        upsert: MockFn;
      };
      profileSource: {
        upsert: MockFn;
      };
    };
  };

  beforeEach(() => {
    mockDb = {
      client: {
        financialProfile: {
          upsert: jest.fn(),
        },
        profileSource: {
          upsert: jest.fn(),
        },
      },
    };
    service = new FinancialProfileService(mockDb as unknown as DatabaseUnitOfWork);
  });

  describe("calculate()", () => {
    it("returns null values and 0 completeness when input data is null", () => {
      const result = service.calculate(null);
      expect(result.averageMonthlyIncome).toBeNull();
      expect(result.averageMonthlyExpenses).toBeNull();
      expect(result.disposableIncome).toBeNull();
      expect(result.totalDebt).toBeNull();
      expect(result.activeCredits).toBeNull();
      expect(result.debtToIncome).toBeNull();
      expect(result.hasRecentArrears).toBeNull();
      expect(result.completeness).toBe(0);
      expect(result.profileVersion).toBe("1.0.0");
    });

    it("calculates all indicators accurately for standard financial data", () => {
      const input: NormalizedFinancialData = {
        documentNumber: "1234567",
        currency: "BOB",
        reportedAt: "2026-10-10T20:00:00.000Z",
        accounts: [
          {
            accountNumberMasked: "BO-****-1234",
            accountType: "SAVINGS",
            currency: "BOB",
            currentBalance: 10000,
            averageMonthlyInflow: 6500,
            averageMonthlyOutflow: 2800,
          },
        ],
        loans: [
          {
            loanId: "L-1",
            loanType: "CONSUMER",
            originalAmount: 15000,
            outstandingBalance: 4200,
            monthlyInstallment: 450,
            status: "ACTIVE",
            daysPastDue: 0,
          },
        ],
      };

      const result = service.calculate(input);
      expect(result.averageMonthlyIncome).toBe(6500);
      expect(result.averageMonthlyExpenses).toBe(2800);
      expect(result.disposableIncome).toBe(3700); // 6500 - 2800
      expect(result.totalDebt).toBe(4200);
      expect(result.activeCredits).toBe(1);
      // DTI = 450 / 6500 = 0.0692
      expect(result.debtToIncome).toBe(0.0692);
      expect(result.hasRecentArrears).toBe(false);
      expect(result.completeness).toBe(1); // 7 / 7 = 1.0000
    });

    it("handles zero debt / empty loans correctly without inventing nulls", () => {
      const input: NormalizedFinancialData = {
        documentNumber: "1234567",
        currency: "BOB",
        reportedAt: "2026-10-10T20:00:00.000Z",
        accounts: [
          {
            accountNumberMasked: "BO-****-1234",
            accountType: "SAVINGS",
            currency: "BOB",
            currentBalance: 5000,
            averageMonthlyInflow: 4000,
            averageMonthlyOutflow: 1500,
          },
        ],
        loans: [],
      };

      const result = service.calculate(input);
      expect(result.averageMonthlyIncome).toBe(4000);
      expect(result.averageMonthlyExpenses).toBe(1500);
      expect(result.disposableIncome).toBe(2500);
      expect(result.totalDebt).toBe(0);
      expect(result.activeCredits).toBe(0);
      expect(result.debtToIncome).toBe(0);
      expect(result.hasRecentArrears).toBe(false);
      expect(result.completeness).toBe(1);
    });

    it("does not divide by zero and keeps uncalculable metrics as null", () => {
      const input: NormalizedFinancialData = {
        documentNumber: "1234567",
        currency: "BOB",
        reportedAt: "2026-10-10T20:00:00.000Z",
        accounts: [
          {
            accountNumberMasked: "BO-****-1234",
            accountType: "SAVINGS",
            currency: "BOB",
            currentBalance: 0,
            averageMonthlyInflow: 0,
            averageMonthlyOutflow: 0,
          },
        ],
        loans: [
          {
            loanId: "L-1",
            loanType: "CONSUMER",
            originalAmount: 5000,
            outstandingBalance: 3000,
            monthlyInstallment: 300,
            status: "ACTIVE",
            daysPastDue: 15,
          },
        ],
      };

      const result = service.calculate(input);
      expect(result.averageMonthlyIncome).toBeNull();
      expect(result.averageMonthlyExpenses).toBeNull();
      expect(result.disposableIncome).toBeNull();
      expect(result.totalDebt).toBe(3000);
      expect(result.activeCredits).toBe(1);
      expect(result.debtToIncome).toBeNull(); // cannot compute DTI with 0/null income
      expect(result.hasRecentArrears).toBe(true); // daysPastDue = 15
      // 3 of 7 non-null
      expect(result.completeness).toBe(Number((3 / 7).toFixed(4)));
    });
  });

  describe("saveProfile()", () => {
    it("upserts financialProfile and profileSource linking them to tenant and evaluation", async () => {
      const indicators = {
        averageMonthlyIncome: 5000,
        averageMonthlyExpenses: 2000,
        disposableIncome: 3000,
        totalDebt: 1000,
        activeCredits: 1,
        debtToIncome: 0.1,
        hasRecentArrears: false,
        completeness: 1,
        profileVersion: "1.0.0",
      };

      mockDb.client.financialProfile.upsert.mockResolvedValueOnce({
        id: "prof-1",
        tenantId: "tenant-1",
        evaluationId: "eval-1",
        ...indicators,
        calculatedAt: new Date("2026-10-10T20:00:00.000Z"),
      });
      mockDb.client.profileSource.upsert.mockResolvedValueOnce({});

      const saved = await service.saveProfile(
        "tenant-1",
        "eval-1",
        "src-res-1",
        indicators,
      );

      expect(saved.id).toBe("prof-1");
      expect(saved.averageMonthlyIncome).toBe(5000);
      expect(mockDb.client.profileSource.upsert).toHaveBeenCalledWith({
        where: {
          tenantId_profileId_sourceResultId: {
            tenantId: "tenant-1",
            profileId: "prof-1",
            sourceResultId: "src-res-1",
          },
        },
        update: {},
        create: {
          tenantId: "tenant-1",
          profileId: "prof-1",
          sourceResultId: "src-res-1",
        },
      });
    });

    it("upserts multiple profileSource records when passed an array of sourceResultIds", async () => {
      const indicators = {
        averageMonthlyIncome: 5000,
        averageMonthlyExpenses: 2000,
        disposableIncome: 3000,
        totalDebt: 1000,
        activeCredits: 1,
        debtToIncome: 0.1,
        hasRecentArrears: false,
        completeness: 1,
        profileVersion: "1.0.0",
      };

      mockDb.client.financialProfile.upsert.mockResolvedValueOnce({
        id: "prof-1",
        tenantId: "tenant-1",
        evaluationId: "eval-1",
        ...indicators,
        calculatedAt: new Date("2026-10-10T20:00:00.000Z"),
      });
      mockDb.client.profileSource.upsert.mockResolvedValue({});

      await service.saveProfile(
        "tenant-1",
        "eval-1",
        ["src-bank-1", "src-bureau-1"],
        indicators,
      );

      expect(mockDb.client.profileSource.upsert).toHaveBeenCalledTimes(2);
      expect(mockDb.client.profileSource.upsert).toHaveBeenCalledWith({
        where: {
          tenantId_profileId_sourceResultId: {
            tenantId: "tenant-1",
            profileId: "prof-1",
            sourceResultId: "src-bank-1",
          },
        },
        update: {},
        create: {
          tenantId: "tenant-1",
          profileId: "prof-1",
          sourceResultId: "src-bank-1",
        },
      });
      expect(mockDb.client.profileSource.upsert).toHaveBeenCalledWith({
        where: {
          tenantId_profileId_sourceResultId: {
            tenantId: "tenant-1",
            profileId: "prof-1",
            sourceResultId: "src-bureau-1",
          },
        },
        update: {},
        create: {
          tenantId: "tenant-1",
          profileId: "prof-1",
          sourceResultId: "src-bureau-1",
        },
      });
    });
  });

  describe("consolidate() (HU-15 / S3-RF-03)", () => {
    const sampleBankData: NormalizedFinancialData = {
      documentNumber: "1234567",
      currency: "BOB",
      reportedAt: "2026-10-10T20:00:00.000Z",
      accounts: [
        {
          accountNumberMasked: "BO-****-1234",
          accountType: "SAVINGS",
          currency: "BOB",
          currentBalance: 8000,
          averageMonthlyInflow: 5000,
          averageMonthlyOutflow: 2000,
        },
      ],
      loans: [
        {
          loanId: "L-1",
          loanType: "CONSUMER",
          originalAmount: 10000,
          outstandingBalance: 6000,
          monthlyInstallment: 600,
          status: "ACTIVE",
          daysPastDue: 0,
        },
      ],
    };

    it("consolidates multi-source debt taking max (S3-RF-03 discrepancy rule) and marks CONSOLIDATED provenance", () => {
      const result = service.consolidate({
        bankData: sampleBankData,
        bureauData: {
          documentNumber: "1234567",
          reportedAt: "2026-10-10T20:00:00.000Z",
          totalSystemDebt: 12000, // Higher than bank's 6000
          activeCreditsCount: 2, // Higher than bank's 1
          monthlyInstallmentsTotal: 1200,
          hasRecentArrears: false,
          worstDelinquencyDays: 0,
          loans: [],
          currency: "BOB",
        },
      });

      expect(result.indicators.averageMonthlyIncome).toBe(5000);
      expect(result.provenance.averageMonthlyIncome).toBe("BANK_MOCK");

      expect(result.indicators.totalDebt).toBe(12000);
      expect(result.provenance.totalDebt).toBe("CONSOLIDATED");

      expect(result.indicators.activeCredits).toBe(2);
      expect(result.provenance.activeCredits).toBe("CONSOLIDATED");

      // DTI = 1200 / 5000 = 0.2400
      expect(result.indicators.debtToIncome).toBe(0.24);
      expect(result.provenance.debtToIncome).toBe("CONSOLIDATED");

      expect(result.indicators.hasRecentArrears).toBe(false);
      expect(result.provenance.hasRecentArrears).toBe("CONSOLIDATED");
    });

    it("detects arrears if Buró reports arrears even when Bank reports zero arrears", () => {
      const result = service.consolidate({
        bankData: sampleBankData,
        bureauData: {
          documentNumber: "1234567",
          reportedAt: "2026-10-10T20:00:00.000Z",
          totalSystemDebt: 8000,
          activeCreditsCount: 1,
          monthlyInstallmentsTotal: 800,
          hasRecentArrears: true, // Delinquent in Bureau
          worstDelinquencyDays: 45,
          loans: [],
          currency: "BOB",
        },
      });

      expect(result.indicators.hasRecentArrears).toBe(true);
      expect(result.provenance.hasRecentArrears).toBe("CONSOLIDATED");
    });

    it("handles Buró NO_DATA without setting indicators to 0 or failing Bank profile (CA-15.06)", () => {
      const result = service.consolidate({
        bankData: sampleBankData,
        bureauData: null,
      });

      expect(result.indicators.averageMonthlyIncome).toBe(5000);
      expect(result.indicators.totalDebt).toBe(6000);
      expect(result.provenance.totalDebt).toBe("BANK_MOCK");
      expect(result.indicators.activeCredits).toBe(1);
      expect(result.provenance.activeCredits).toBe("BANK_MOCK");
      expect(result.indicators.hasRecentArrears).toBe(false);
      expect(result.provenance.hasRecentArrears).toBe("BANK_MOCK");
    });
  });
});
