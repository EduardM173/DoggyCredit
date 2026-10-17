import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { BankMockSource, type SourceQueryResult, type NormalizedFinancialData } from "./public.js";

@Injectable()
export class BankMockSourceService extends BankMockSource {
  constructor(private readonly db: DatabaseUnitOfWork) {
    super();
  }

  async status(tenantId: string) {
    const provider = await this.db.client.integrationProvider.findUnique({
      where: { code: "BANK_MOCK" },
      select: { id: true, status: true },
    });
    if (!provider) return { available: false, enabled: false, healthStatus: "INACTIVE" as const };
    const source = await this.db.client.tenantIntegration.findUnique({
      where: { tenantId_providerId: { tenantId, providerId: provider.id } },
      select: { enabled: true, status: true },
    });
    return {
      available: provider.status === "ACTIVE",
      enabled: provider.status === "ACTIVE" && source?.enabled === true && source.status === "ACTIVE",
      healthStatus: provider.status as "ACTIVE" | "DEGRADED" | "INACTIVE",
    };
  }

  async enable(tenantId: string) {
    const provider = await this.db.client.integrationProvider.findUnique({ where: { code: "BANK_MOCK" } });
    if (provider?.status !== "ACTIVE")
      throw new ServiceUnavailableException(
        "La fuente bancaria no está disponible. Intenta nuevamente más tarde.",
      );
    const current = await this.db.client.tenantIntegration.findUnique({
      where: { tenantId_providerId: { tenantId, providerId: provider.id } },
    });
    if (current?.enabled && current.status === "ACTIVE") return false;
    await this.db.client.tenantIntegration.upsert({
      where: { tenantId_providerId: { tenantId, providerId: provider.id } },
      update: { enabled: true, status: "ACTIVE", lastErrorCode: null },
      create: { tenantId, providerId: provider.id, enabled: true, status: "ACTIVE" },
    });
    return true;
  }

  async query(tenantId: string, documentNumber: string): Promise<SourceQueryResult> {
    const provider = await this.db.client.integrationProvider.findUnique({
      where: { code: "BANK_MOCK" },
      select: { id: true, status: true },
    });
    if (!provider || provider.status !== "ACTIVE") {
      throw new ServiceUnavailableException("La fuente bancaria simulada no está disponible en la plataforma.");
    }
    const tenantIntegration = await this.db.client.tenantIntegration.findUnique({
      where: { tenantId_providerId: { tenantId, providerId: provider.id } },
      select: { enabled: true, status: true },
    });
    if (!tenantIntegration?.enabled || tenantIntegration.status !== "ACTIVE") {
      throw new ServiceUnavailableException("La fuente bancaria simulada no está habilitada para esta institución.");
    }

    const doc = documentNumber.trim();
    const ref = `BM-${doc}-${Date.now().toString().slice(-6)}`;

    // Fixture scenario: UNAVAILABLE
    if (doc.endsWith("999") || doc === "503503") {
      return {
        status: "UNAVAILABLE",
        message: "El servicio bancario externo no se encuentra disponible temporalmente.",
        errorCode: "BANK_UNAVAILABLE",
        retryable: true,
        providerId: provider.id,
      };
    }

    // Fixture scenario: ERROR
    if (doc.endsWith("500") || doc === "9999500") {
      return {
        status: "ERROR",
        message: "Ocurrió un error inesperado al consultar la fuente bancaria.",
        errorCode: "BANK_TIMEOUT",
        retryable: true,
        providerId: provider.id,
      };
    }

    // Fixture scenario: NO_DATA
    if (doc.endsWith("000") || doc === "0000000") {
      return {
        status: "NO_DATA",
        message: "La fuente bancaria no dispone de antecedentes financieros para el solicitante.",
        externalReference: ref,
        providerId: provider.id,
      };
    }

    // Fixture scenario: Incomplete data (e.g. ends with "111")
    if (doc.endsWith("111")) {
      const data: NormalizedFinancialData = {
        documentNumber: doc,
        accounts: [
          {
            accountNumberMasked: "BO-****-1111",
            accountType: "SAVINGS",
            currency: "BOB",
            currentBalance: 5200.0,
            averageMonthlyInflow: 4800.0,
            averageMonthlyOutflow: 0,
          },
        ],
        loans: [],
        reportedAt: new Date().toISOString(),
        currency: "BOB",
      };
      return {
        status: "SUCCESS",
        data,
        externalReference: ref,
        providerId: provider.id,
      };
    }

    // Fixture scenario: Standard SUCCESS
    const data: NormalizedFinancialData = {
      documentNumber: doc,
      accounts: [
        {
          accountNumberMasked: "BO-****-7890",
          accountType: "SAVINGS",
          currency: "BOB",
          currentBalance: 8450.0,
          averageMonthlyInflow: 6500.0,
          averageMonthlyOutflow: 2800.0,
        },
      ],
      loans: [
        {
          loanId: `L-${doc.slice(-4)}-01`,
          loanType: "CONSUMER",
          originalAmount: 15000.0,
          outstandingBalance: 4200.0,
          monthlyInstallment: 450.0,
          status: "ACTIVE",
          daysPastDue: 0,
        },
      ],
      reportedAt: new Date().toISOString(),
      currency: "BOB",
    };

    return {
      status: "SUCCESS",
      data,
      externalReference: ref,
      providerId: provider.id,
    };
  }
}
