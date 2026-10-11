import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { ClientsService } from "../clients/public.js";
import { TenantPreparationService, type TenantContext } from "../identity-tenants/public.js";
import { AuditWriter } from "../audit/public.js";
import { BankMockSource } from "../financial-integrations/public.js";
import { FinancialProfileCalculator } from "../financial-profile/public.js";
import { EvaluationRecommender } from "../recommendations/public.js";
import type { CreateEvaluationDto, DocumentTypeDto, ClientTypeDto } from "./dto/create-evaluation.dto.js";
import type { DocumentType, CreditPurpose, ClientType } from "../generated/prisma/client.js";

@Injectable()
export class EvaluationsService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly clients: ClientsService,
    private readonly preparation: TenantPreparationService,
    private readonly audit: AuditWriter,
    private readonly bank: BankMockSource,
    private readonly profileCalculator: FinancialProfileCalculator,
    private readonly recommender: EvaluationRecommender,
  ) {}

  async checkReadiness(ctx: TenantContext) {
    const status = await this.preparation.read(ctx);
    const products = status.products ?? [];
    const isBankEnabled = Boolean(status.source?.enabled ?? status.steps?.source);

    const hasCompanyProduct =
      products.length > 0
        ? products.some(
            (p) =>
              p.selected &&
              (p.applicantScope === "COMPANY" || p.applicantScope === "BOTH"),
          )
        : false;

    const hasPersonProduct =
      products.length > 0
        ? products.some(
            (p) =>
              p.selected &&
              (p.applicantScope === "PERSON" || p.applicantScope === "BOTH"),
          )
        : Boolean(status.steps?.products);

    const supportedApplicantTypes = {
      PERSON: {
        supported: isBankEnabled && hasPersonProduct,
        reason: !isBankEnabled
          ? "La institución no tiene fuentes financieras habilitadas."
          : !hasPersonProduct
            ? "Tu institución no cuenta con productos crediticios activos para personas."
            : undefined,
      },
      COMPANY: {
        supported: isBankEnabled && hasCompanyProduct,
        reason: !isBankEnabled
          ? "No hay fuentes financieras habilitadas con cobertura empresarial para tu institución."
          : !hasCompanyProduct
            ? "Tu institución no cuenta con productos crediticios activos para empresas. Configura al menos un producto empresarial en la sección de Productos."
            : undefined,
      },
    };

    const statusObj = status as { ready?: boolean };
    const isReady =
      typeof statusObj.ready === "boolean" ? statusObj.ready : status.completed === 3;

    return {
      ready: isReady,
      completed: status.completed,
      percentage: status.percentage,
      steps: status.steps,
      tenantName: status.tenant?.name ?? "",
      supportedApplicantTypes,
    };
  }

  async searchClient(
    ctx: TenantContext,
    documentType: DocumentTypeDto | DocumentType,
    documentNumber: string,
    clientType: ClientTypeDto | ClientType = "PERSON",
  ) {
    const client = await this.clients.findByDocument(
      ctx.tenantId,
      documentType as unknown as DocumentType,
      documentNumber,
      clientType as unknown as ClientType,
    );
    if (!client) return null;
    return {
      id: client.id,
      name: client.name,
      documentType: client.documentType,
      documentNumber: client.documentNumber,
      type: client.type,
      economicActivity: client.economicActivity,
    };
  }

  async createDraft(ctx: TenantContext, dto: CreateEvaluationDto) {
    const readiness = await this.checkReadiness(ctx);
    if (!readiness.ready) {
      throw new BadRequestException(
        "La institución no ha completado la preparación requerida (fuentes y productos) para realizar evaluaciones.",
      );
    }

    const clientType = (dto.clientType as unknown as ClientType) || "PERSON";
    if (clientType === "COMPANY") {
      const companySupport = readiness.supportedApplicantTypes.COMPANY;
      if (!companySupport.supported) {
        throw new BadRequestException(
          companySupport.reason ||
            "La evaluación de empresas no está admitida en esta institución debido a la cobertura de productos o fuentes vigentes.",
        );
      }
    } else {
      const personSupport = readiness.supportedApplicantTypes.PERSON;
      if (!personSupport.supported) {
        throw new BadRequestException(
          personSupport.reason ||
            "La evaluación de personas no está admitida en esta institución debido a la cobertura de productos o fuentes vigentes.",
        );
      }
    }

    if (!dto.consentGiven) {
      throw new BadRequestException(
        "Se requiere el consentimiento del solicitante para preparar la evaluación.",
      );
    }

    const idempotencyKey = dto.idempotencyKey?.trim() || randomUUID();

    const existing = await this.db.client.evaluation.findUnique({
      where: { idempotencyKey },
      include: { client: true, profile: true, sourceResults: true },
    });
    if (existing) {
      if (existing.tenantId !== ctx.tenantId) {
        throw new ForbiddenException("No tienes acceso a esta evaluación.");
      }
      return this.serializeEvaluation(existing);
    }

    return this.db.run(async () => {
      const { client } = await this.clients.findOrCreate(ctx.tenantId, {
        type: clientType,
        documentType: dto.documentType as unknown as DocumentType,
        documentNumber: dto.documentNumber,
        name: dto.name,
        economicActivity: dto.economicActivity,
      });

      const now = new Date();
      const statement =
        clientType === "COMPANY"
          ? "La empresa solicitante autoriza formalmente la consulta, verificación de antecedentes financieros y procesamiento de evaluación crediticia institucional."
          : "El solicitante autoriza la consulta y verificación de su información financiera para fines de evaluación crediticia.";

      const applicantSnapshot = {
        id: client.id,
        type: client.type,
        documentType: client.documentType,
        documentNumber: client.documentNumber,
        name: client.name,
        economicActivity: client.economicActivity ?? null,
        consent: {
          given: true,
          timestamp: now.toISOString(),
          actorMembershipId: ctx.membershipId,
          actorName: ctx.userName,
          actorUserId: ctx.userId,
          statement,
        },
      };

      const evaluation = await this.db.client.evaluation.create({
        data: {
          tenantId: ctx.tenantId,
          clientId: client.id,
          createdByMembershipId: ctx.membershipId,
          idempotencyKey,
          purpose: dto.purpose as unknown as CreditPurpose,
          requestedAmount: dto.requestedAmount,
          status: "DRAFT",
          consentGivenAt: now,
          applicantSnapshot,
          ruleVersion: "1.0.0",
        },
        include: { client: true, profile: true, sourceResults: true },
      });

      await this.audit.recordEvaluationDraft({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        evaluationId: evaluation.id,
      });

      return this.serializeEvaluation(evaluation);
    });
  }

  async list(ctx: TenantContext) {
    const list = await this.db.client.evaluation.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        client: true,
        profile: true,
        sourceResults: true,
        recommendations: {
          include: { product: true, reasons: true },
          orderBy: { evaluatedAt: "asc" },
        },
      },
    });
    return list.map((ev) => this.serializeEvaluation(ev));
  }

  async getById(ctx: TenantContext, evaluationId: string) {
    const evaluation = await this.db.client.evaluation.findFirst({
      where: { id: evaluationId, tenantId: ctx.tenantId },
      include: {
        client: true,
        profile: true,
        sourceResults: true,
        recommendations: {
          include: { product: true, reasons: true },
          orderBy: { evaluatedAt: "asc" },
        },
      },
    });
    if (!evaluation) {
      throw new NotFoundException("Evaluación no encontrada.");
    }
    return this.serializeEvaluation(evaluation);
  }

  async processEvaluation(ctx: TenantContext, evaluationId: string) {
    const evaluation = await this.db.client.evaluation.findFirst({
      where: { id: evaluationId, tenantId: ctx.tenantId },
      include: {
        client: true,
        profile: true,
        sourceResults: true,
        recommendations: {
          include: { product: true, reasons: true },
          orderBy: { evaluatedAt: "asc" },
        },
      },
    });
    if (!evaluation) {
      throw new NotFoundException("Evaluación no encontrada.");
    }

    // CA-11.19: If already COMPLETED, return current state without creating a duplicate
    if (evaluation.status === "COMPLETED") {
      return this.serializeEvaluation(evaluation);
    }

    const readiness = await this.checkReadiness(ctx);
    if (!readiness.ready) {
      throw new BadRequestException(
        "La institución no cumple las condiciones mínimas para evaluar.",
      );
    }

    if (!evaluation.consentGivenAt) {
      throw new BadRequestException(
        "La evaluación no cuenta con consentimiento registrado para consultar fuentes.",
      );
    }

    // CA-11.01: Transition to IN_PROGRESS
    await this.db.client.evaluation.update({
      where: { id: evaluation.id },
      data: {
        status: "IN_PROGRESS",
        startedAt: evaluation.startedAt ?? new Date(),
      },
    });

    const snapshot = evaluation.applicantSnapshot as Record<string, unknown> | null;
    const documentNumber = evaluation.client?.documentNumber ?? (snapshot?.documentNumber as string);

    // CA-11.05: Encapsulated query to Bank Mock
    const queryResult = await this.bank.query(ctx.tenantId, documentNumber);

    // CA-11.08: Save source result with provenance, state and timestamp
    const existingSource = await this.db.client.evaluationSourceResult.findFirst({
      where: {
        tenantId: ctx.tenantId,
        evaluationId: evaluation.id,
        providerId: queryResult.providerId,
      },
    });
    const attemptCount = existingSource ? existingSource.attemptCount + 1 : 1;
    const sourceResultId = existingSource?.id ?? randomUUID();

    const persistedSource = await this.db.client.evaluationSourceResult.upsert({
      where: { id: sourceResultId },
      update: {
        status: queryResult.status,
        attemptCount,
        externalReference:
          "externalReference" in queryResult ? queryResult.externalReference : null,
        errorCode: "errorCode" in queryResult ? queryResult.errorCode : null,
        normalizedPayload:
          queryResult.status === "SUCCESS" ? (queryResult.data as unknown as object) : undefined,
        respondedAt: new Date(),
      },
      create: {
        id: sourceResultId,
        tenantId: ctx.tenantId,
        evaluationId: evaluation.id,
        providerId: queryResult.providerId,
        status: queryResult.status,
        attemptCount: 1,
        externalReference:
          "externalReference" in queryResult ? queryResult.externalReference : null,
        errorCode: "errorCode" in queryResult ? queryResult.errorCode : null,
        normalizedPayload:
          queryResult.status === "SUCCESS" ? (queryResult.data as unknown as object) : undefined,
        respondedAt: new Date(),
      },
    });

    // Handle outcome according to S2-RF-05 / CA-11.09 / HU-12
    if (queryResult.status === "SUCCESS") {
      const indicators = this.profileCalculator.calculate(queryResult.data);
      await this.profileCalculator.saveProfile(
        ctx.tenantId,
        evaluation.id,
        persistedSource.id,
        indicators,
      );

      // CA-12.01, CA-12.04 & CA-14.01: Run deterministic and versioned recommendations
      const snapshot = evaluation.applicantSnapshot as {
        type?: "PERSON" | "COMPANY";
      } | null;
      const applicantScope: "PERSON" | "COMPANY" =
        (evaluation.client?.type as "PERSON" | "COMPANY") ||
        snapshot?.type ||
        "PERSON";

      await this.recommender.evaluate(ctx.tenantId, evaluation.id, {
        applicantScope,
        purpose: evaluation.purpose,
        requestedAmount: Number(evaluation.requestedAmount),
        profile: indicators,
      });

      const completed = await this.db.client.evaluation.update({
        where: { id: evaluation.id },
        data: {
          status: "COMPLETED",
          ruleVersion: "1.0.0",
          completedAt: new Date(),
          failureCode: null,
          failureMessage: null,
        },
        include: {
          client: true,
          profile: true,
          sourceResults: true,
          recommendations: {
            include: { product: true, reasons: true },
            orderBy: { evaluatedAt: "asc" },
          },
        },
      });

      await this.audit.recordEvaluationProcessed({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        evaluationId: evaluation.id,
        status: "COMPLETED",
      });

      return this.serializeEvaluation(completed);
    }

    if (queryResult.status === "NO_DATA") {
      const incomplete = await this.db.client.evaluation.update({
        where: { id: evaluation.id },
        data: {
          status: "INCOMPLETE",
          completedAt: new Date(),
          failureCode: "NO_FINANCIAL_DATA",
          failureMessage: queryResult.message,
        },
        include: {
          client: true,
          profile: true,
          sourceResults: true,
          recommendations: {
            include: { product: true, reasons: true },
            orderBy: { evaluatedAt: "asc" },
          },
        },
      });

      await this.audit.recordEvaluationProcessed({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        evaluationId: evaluation.id,
        status: "INCOMPLETE",
      });

      return this.serializeEvaluation(incomplete);
    }

    // UNAVAILABLE or ERROR -> FAILED (retryable)
    const failed = await this.db.client.evaluation.update({
      where: { id: evaluation.id },
      data: {
        status: "FAILED",
        failureCode: queryResult.errorCode,
        failureMessage: queryResult.message,
      },
      include: {
        client: true,
        profile: true,
        sourceResults: true,
        recommendations: {
          include: { product: true, reasons: true },
          orderBy: { evaluatedAt: "asc" },
        },
      },
    });

    await this.audit.recordEvaluationProcessed({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      evaluationId: evaluation.id,
      status: "FAILED",
    });

    return this.serializeEvaluation(failed);
  }

  private serializeEvaluation(ev: {
    id: string;
    tenantId: string;
    clientId: string;
    client?: { name: string; documentType: string; documentNumber: string } | null;
    purpose: string;
    requestedAmount: unknown;
    status: string;
    consentGivenAt: Date | null;
    applicantSnapshot: unknown;
    ruleVersion: string | null;
    failureCode?: string | null;
    failureMessage?: string | null;
    startedAt?: Date | null;
    completedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
    profile?: {
      id: string;
      averageMonthlyIncome: unknown;
      averageMonthlyExpenses: unknown;
      disposableIncome: unknown;
      totalDebt: unknown;
      activeCredits: number | null;
      debtToIncome: unknown;
      hasRecentArrears: boolean | null;
      completeness: unknown;
      profileVersion: string;
      calculatedAt: Date;
    } | null;
    sourceResults?: Array<{
      id: string;
      providerId: string;
      status: string;
      attemptCount: number;
      externalReference: string | null;
      errorCode: string | null;
      requestedAt: Date;
      respondedAt: Date | null;
    }>;
    recommendations?: Array<{
      id: string;
      productId: string;
      product?: {
        name: string;
        category: string;
        minAmount: unknown;
        maxAmount: unknown;
      } | null;
      outcome: string;
      ruleVersion: string;
      evaluatedAt: Date;
      reasons?: Array<{
        code: string;
        message: string;
        passed: boolean;
      }>;
    }>;
  }) {
    const snapshot = ev.applicantSnapshot as Record<string, unknown> | null;
    return {
      id: ev.id,
      tenantId: ev.tenantId,
      clientId: ev.clientId,
      clientName: ev.client?.name ?? (snapshot?.name as string) ?? "Solicitante",
      documentType: ev.client?.documentType ?? (snapshot?.documentType as string) ?? "CI",
      documentNumber: ev.client?.documentNumber ?? (snapshot?.documentNumber as string) ?? "",
      purpose: ev.purpose,
      requestedAmount: Number(ev.requestedAmount),
      status: ev.status,
      consentGivenAt: ev.consentGivenAt,
      applicantSnapshot: ev.applicantSnapshot,
      ruleVersion: ev.ruleVersion,
      failureCode: ev.failureCode ?? null,
      failureMessage: ev.failureMessage ?? null,
      startedAt: ev.startedAt ?? null,
      completedAt: ev.completedAt ?? null,
      createdAt: ev.createdAt,
      updatedAt: ev.updatedAt,
      profile: ev.profile
        ? {
            id: ev.profile.id,
            averageMonthlyIncome:
              ev.profile.averageMonthlyIncome !== null
                ? Number(ev.profile.averageMonthlyIncome)
                : null,
            averageMonthlyExpenses:
              ev.profile.averageMonthlyExpenses !== null
                ? Number(ev.profile.averageMonthlyExpenses)
                : null,
            disposableIncome:
              ev.profile.disposableIncome !== null
                ? Number(ev.profile.disposableIncome)
                : null,
            totalDebt:
              ev.profile.totalDebt !== null ? Number(ev.profile.totalDebt) : null,
            activeCredits: ev.profile.activeCredits,
            debtToIncome:
              ev.profile.debtToIncome !== null
                ? Number(ev.profile.debtToIncome)
                : null,
            hasRecentArrears: ev.profile.hasRecentArrears,
            completeness: Number(ev.profile.completeness),
            profileVersion: ev.profile.profileVersion,
            calculatedAt: ev.profile.calculatedAt,
          }
        : null,
      sourceResults: (ev.sourceResults ?? []).map((sr) => ({
        id: sr.id,
        providerId: sr.providerId,
        status: sr.status,
        attemptCount: sr.attemptCount,
        externalReference: sr.externalReference,
        errorCode: sr.errorCode,
        requestedAt: sr.requestedAt,
        respondedAt: sr.respondedAt,
      })),
      recommendations: (ev.recommendations ?? []).map((r) => ({
        id: r.id,
        productId: r.productId,
        productName: r.product?.name ?? "Producto",
        category: r.product?.category ?? "MICRO_CREDIT",
        outcome: r.outcome,
        ruleVersion: r.ruleVersion,
        minAmount: r.product?.minAmount !== undefined ? Number(r.product.minAmount) : 0,
        maxAmount: r.product?.maxAmount !== undefined ? Number(r.product.maxAmount) : 0,
        evaluatedAt: r.evaluatedAt,
        reasons: (r.reasons ?? []).map((reas) => ({
          code: reas.code,
          message: reas.message,
          passed: reas.passed,
        })),
      })),
    };
  }
}
