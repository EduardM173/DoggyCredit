import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import type { TenantContext } from "../identity-tenants/public.js";
import type { Client, ClientType, DocumentType } from "../generated/prisma/client.js";

export interface CreateClientInput {
  type: ClientType;
  documentType: DocumentType;
  documentNumber: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  economicActivity?: string;
}

@Injectable()
export class ClientsService {
  constructor(private readonly db: DatabaseUnitOfWork) {}

  async findByDocument(
    tenantId: string,
    documentType: DocumentType,
    documentNumber: string,
    type?: ClientType,
  ): Promise<Client | null> {
    const normalizedDoc = documentNumber.trim();
    const client = await this.db.client.client.findUnique({
      where: {
        tenantId_documentType_documentNumber: {
          tenantId,
          documentType,
          documentNumber: normalizedDoc,
        },
      },
    });
    if (!client) return null;
    if (type && client.type !== type) return null;
    return client;
  }

  async findOrCreate(
    tenantId: string,
    input: CreateClientInput,
  ): Promise<{ client: Client; created: boolean }> {
    const normalizedDoc = input.documentNumber.trim();
    const normalizedName = input.name.trim().replace(/\s+/g, " ");

    const existing = await this.findByDocument(
      tenantId,
      input.documentType,
      normalizedDoc,
      input.type,
    );
    if (existing) {
      return { client: existing, created: false };
    }

    const client = await this.db.client.client.create({
      data: {
        tenantId,
        type: input.type,
        documentType: input.documentType,
        documentNumber: normalizedDoc,
        name: normalizedName,
        email: input.email?.trim().toLowerCase() || null,
        phone: input.phone?.trim() || null,
        address: input.address?.trim() || null,
        economicActivity: input.economicActivity?.trim() || null,
      },
    });

    return { client, created: true };
  }

  async getDossier(ctx: TenantContext, clientId: string) {
    const client = await this.db.client.client.findFirst({
      where: {
        id: clientId,
        tenantId: ctx.tenantId,
      },
    });

    if (!client) {
      throw new NotFoundException(
        "El expediente solicitado no existe o no pertenece a la institución actual.",
      );
    }

    const evaluations = await this.db.client.evaluation.findMany({
      where: {
        tenantId: ctx.tenantId,
        clientId: client.id,
      },
      orderBy: { createdAt: "desc" },
      include: {
        profile: true,
        sourceResults: {
          include: { provider: true },
          orderBy: { requestedAt: "asc" },
        },
        recommendations: {
          include: { product: true, reasons: true },
          orderBy: { evaluatedAt: "asc" },
        },
      },
    });

    const latestEvaluationWithProfile = evaluations.find((e) => e.profile !== null);
    const latestProfile = latestEvaluationWithProfile?.profile || null;

    return {
      client: {
        id: client.id,
        tenantId: client.tenantId,
        type: client.type,
        documentType: client.documentType,
        documentNumber: client.documentNumber,
        name: client.name,
        email: client.email,
        phone: client.phone,
        address: client.address,
        economicActivity: client.economicActivity,
        createdAt: client.createdAt.toISOString(),
        updatedAt: client.updatedAt.toISOString(),
      },
      evaluations: evaluations.map((ev) => ({
        id: ev.id,
        purpose: ev.purpose,
        requestedAmount: Number(ev.requestedAmount),
        status: ev.status,
        createdAt: ev.createdAt.toISOString(),
        completedAt: ev.completedAt ? ev.completedAt.toISOString() : null,
        ruleVersion: ev.ruleVersion,
        applicantSnapshot: ev.applicantSnapshot,
        recommendationsCount: ev.recommendations.length,
        compatibleProductsCount: ev.recommendations.filter(
          (r) => r.outcome === "RECOMMENDED",
        ).length,
      })),
      latestFinancialProfile: latestProfile
        ? {
            id: latestProfile.id,
            averageMonthlyIncome:
              latestProfile.averageMonthlyIncome !== null
                ? Number(latestProfile.averageMonthlyIncome)
                : null,
            averageMonthlyExpenses:
              latestProfile.averageMonthlyExpenses !== null
                ? Number(latestProfile.averageMonthlyExpenses)
                : null,
            disposableIncome:
              latestProfile.disposableIncome !== null
                ? Number(latestProfile.disposableIncome)
                : null,
            totalDebt:
              latestProfile.totalDebt !== null
                ? Number(latestProfile.totalDebt)
                : null,
            activeCredits: latestProfile.activeCredits,
            debtToIncome:
              latestProfile.debtToIncome !== null
                ? Number(latestProfile.debtToIncome)
                : null,
            hasRecentArrears: latestProfile.hasRecentArrears,
            completeness: Number(latestProfile.completeness),
            calculatedAt: latestProfile.calculatedAt.toISOString(),
            sourceEvaluationId: latestEvaluationWithProfile?.id,
          }
        : null,
    };
  }
}
