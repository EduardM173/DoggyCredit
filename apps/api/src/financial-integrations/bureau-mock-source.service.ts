import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import type { SourceStatus, BureauQueryResult } from "./public.js";

export abstract class BureauMockSource {
  abstract status(tenantId: string): Promise<SourceStatus>;
  abstract enable(tenantId: string, enabled?: boolean): Promise<boolean>;
  abstract query(tenantId: string, documentNumber: string): Promise<BureauQueryResult>;
}

@Injectable()
export class BureauMockSourceService extends BureauMockSource {
  constructor(private readonly db: DatabaseUnitOfWork) {
    super();
  }

  async status(tenantId: string): Promise<SourceStatus> {
    const provider = await this.db.client.integrationProvider.findUnique({
      where: { code: "BUREAU_MOCK" },
      select: { id: true, status: true },
    });
    if (!provider) {
      return { available: false, enabled: false, healthStatus: "INACTIVE" };
    }
    const source = await this.db.client.tenantIntegration.findUnique({
      where: { tenantId_providerId: { tenantId, providerId: provider.id } },
      select: { enabled: true, status: true },
    });
    const isAvailable = provider.status === "ACTIVE";
    return {
      available: isAvailable,
      enabled: isAvailable && source?.enabled === true && source.status === "ACTIVE",
      healthStatus: provider.status as "ACTIVE" | "DEGRADED" | "INACTIVE",
    };
  }

  async enable(tenantId: string, enabled = true): Promise<boolean> {
    const provider = await this.db.client.integrationProvider.findUnique({
      where: { code: "BUREAU_MOCK" },
    });
    if (!provider || provider.status !== "ACTIVE") {
      throw new ServiceUnavailableException(
        "El Buró crediticio simulado no está disponible en la plataforma. Intenta nuevamente más tarde.",
      );
    }
    const current = await this.db.client.tenantIntegration.findUnique({
      where: { tenantId_providerId: { tenantId, providerId: provider.id } },
    });
    const currentEnabled = current?.enabled === true && current.status === "ACTIVE";
    if (currentEnabled === enabled) {
      return false;
    }
    await this.db.client.tenantIntegration.upsert({
      where: { tenantId_providerId: { tenantId, providerId: provider.id } },
      update: { enabled, status: "ACTIVE", lastErrorCode: null },
      create: { tenantId, providerId: provider.id, enabled, status: "ACTIVE" },
    });
    return true;
  }

  async query(tenantId: string, documentNumber: string) {
    const provider = await this.db.client.integrationProvider.findUnique({
      where: { code: "BUREAU_MOCK" },
      select: { id: true, status: true },
    });
    if (!provider || provider.status !== "ACTIVE") {
      throw new ServiceUnavailableException("El Buró crediticio simulado no está disponible en la plataforma.");
    }

    const tenantIntegration = await this.db.client.tenantIntegration.findUnique({
      where: { tenantId_providerId: { tenantId, providerId: provider.id } },
      select: { enabled: true, status: true },
    });
    if (!tenantIntegration?.enabled || tenantIntegration.status !== "ACTIVE") {
      throw new ServiceUnavailableException("El Buró crediticio simulado no está habilitado para esta institución.");
    }

    const doc = documentNumber.trim();
    const ref = `BUR-${doc}-${Date.now().toString().slice(-6)}`;

    // Fixture scenario: UNAVAILABLE (ends with 999 or is 503503)
    if (doc.endsWith("999") || doc === "503503") {
      return {
        status: "UNAVAILABLE" as const,
        message: "El servicio de Buró crediticio externo no se encuentra disponible temporalmente.",
        errorCode: "BUREAU_UNAVAILABLE",
        retryable: true as const,
        providerId: provider.id,
      };
    }

    // Fixture scenario: ERROR (ends with 500 or is 9999500)
    if (doc.endsWith("500") || doc === "9999500") {
      return {
        status: "ERROR" as const,
        message: "Ocurrió un error inesperado al consultar el Buró crediticio simulado.",
        errorCode: "BUREAU_TIMEOUT",
        retryable: true as const,
        providerId: provider.id,
      };
    }

    // Fixture scenario: NO_DATA (ends with 000, 001, or is 0000000)
    if (doc.endsWith("000") || doc.endsWith("001") || doc === "0000000") {
      return {
        status: "NO_DATA" as const,
        message: "El Buró crediticio no dispone de antecedentes financieros para el solicitante.",
        externalReference: ref,
        providerId: provider.id,
      };
    }

    // Fixture scenario: Delinquency / Arrears (ends with 666)
    if (doc.endsWith("666")) {
      return {
        status: "SUCCESS" as const,
        data: {
          documentNumber: doc,
          totalSystemDebt: 45000,
          activeCreditsCount: 2,
          worstDelinquencyDays: 90,
          hasRecentArrears: true,
          loans: [
            {
              entityName: "Banco Ganadero",
              loanType: "CONSUMER" as const,
              originalAmount: 25000,
              outstandingBalance: 20000,
              monthlyInstallment: 950,
              status: "DELINQUENT" as const,
              daysPastDue: 90,
            },
            {
              entityName: "Banco Mercantil Santa Cruz",
              loanType: "CREDIT_CARD" as const,
              originalAmount: 30000,
              outstandingBalance: 25000,
              monthlyInstallment: 1200,
              status: "DELINQUENT" as const,
              daysPastDue: 45,
            },
          ],
          reportedAt: new Date().toISOString().split("T")[0],
          currency: "BOB",
        },
        externalReference: ref,
        providerId: provider.id,
      };
    }

    // Standard SUCCESS scenario (clean history in financial system)
    return {
      status: "SUCCESS" as const,
      data: {
        documentNumber: doc,
        totalSystemDebt: 18000,
        activeCreditsCount: 1,
        worstDelinquencyDays: 0,
        hasRecentArrears: false,
        loans: [
          {
            entityName: "Banco FIE",
            loanType: "CONSUMER" as const,
            originalAmount: 25000,
            outstandingBalance: 18000,
            monthlyInstallment: 750,
            status: "ACTIVE" as const,
            daysPastDue: 0,
          },
        ],
        reportedAt: new Date().toISOString().split("T")[0],
        currency: "BOB",
      },
      externalReference: ref,
      providerId: provider.id,
    };
  }
}
