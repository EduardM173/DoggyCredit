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
import {
  BankMockSource,
  BureauMockSource,
  type NormalizedFinancialData,
  type NormalizedBureauData,
} from "../financial-integrations/public.js";
import {
  FinancialProfileCalculator,
  type ProfileIndicatorProvenance,
} from "../financial-profile/public.js";
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
    private readonly bureau: BureauMockSource,
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
    return list.map((ev) => this.serializeEvaluation(ev));
  }

  async getById(ctx: TenantContext, evaluationId: string) {
    const evaluation = await this.db.client.evaluation.findFirst({
      where: { id: evaluationId, tenantId: ctx.tenantId },
      include: {
        client: true,
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
    if (!evaluation) {
      throw new NotFoundException("Evaluación no encontrada.");
    }

    // CA-11.19 / CA-15.09: If already COMPLETED, return current state without creating a duplicate
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
    const documentNumber =
      evaluation.client?.documentNumber ?? (snapshot?.documentNumber as string);

    // Identify enabled sources for the tenant (CA-15.01, CA-15.02)
    const bureauStatus = await this.bureau.status(ctx.tenantId);
    const isBureauEnabled = Boolean(bureauStatus.enabled && bureauStatus.available);

    const bankProvider = await this.db.client.integrationProvider.findUnique({
      where: { code: "BANK_MOCK" },
    });
    const bureauProvider = isBureauEnabled
      ? await this.db.client.integrationProvider.findUnique({
          where: { code: "BUREAU_MOCK" },
        })
      : null;

    // CA-15.10: Safe re-attempting - inspect existing source results
    const existingBank = (evaluation.sourceResults ?? []).find(
      (sr) =>
        sr.provider?.code === "BANK_MOCK" ||
        (bankProvider && sr.providerId === bankProvider.id),
    );
    const existingBureau = isBureauEnabled
      ? (evaluation.sourceResults ?? []).find(
          (sr) =>
            sr.provider?.code === "BUREAU_MOCK" ||
            (bureauProvider && sr.providerId === bureauProvider.id),
        )
      : null;

    // 1. Bank Mock Query or Reuse
    let bankStatus: "SUCCESS" | "NO_DATA" | "UNAVAILABLE" | "ERROR";
    let bankResultId: string;
    let bankPayload: NormalizedFinancialData | null = null;
    let bankErrorMessage: string | null = null;
    let bankErrorCode: string | null = null;

    if (existingBank && existingBank.status === "SUCCESS") {
      bankStatus = "SUCCESS";
      bankResultId = existingBank.id;
      bankPayload = existingBank.normalizedPayload as unknown as NormalizedFinancialData;
    } else {
      const bankQueryResult = await this.bank.query(ctx.tenantId, documentNumber);
      bankStatus = bankQueryResult.status;
      const attemptCount = existingBank ? existingBank.attemptCount + 1 : 1;
      const id = existingBank?.id ?? randomUUID();

      const persistedBank = await this.db.client.evaluationSourceResult.upsert({
        where: { id },
        update: {
          status: bankQueryResult.status,
          attemptCount,
          externalReference:
            "externalReference" in bankQueryResult ? bankQueryResult.externalReference : null,
          errorCode: "errorCode" in bankQueryResult ? bankQueryResult.errorCode : null,
          normalizedPayload:
            bankQueryResult.status === "SUCCESS"
              ? (bankQueryResult.data as unknown as object)
              : undefined,
          respondedAt: new Date(),
        },
        create: {
          id,
          tenantId: ctx.tenantId,
          evaluationId: evaluation.id,
          providerId: bankQueryResult.providerId,
          status: bankQueryResult.status,
          attemptCount: 1,
          externalReference:
            "externalReference" in bankQueryResult ? bankQueryResult.externalReference : null,
          errorCode: "errorCode" in bankQueryResult ? bankQueryResult.errorCode : null,
          normalizedPayload:
            bankQueryResult.status === "SUCCESS"
              ? (bankQueryResult.data as unknown as object)
              : undefined,
          respondedAt: new Date(),
        },
      });

      bankResultId = persistedBank.id;
      if (bankQueryResult.status === "SUCCESS") {
        bankPayload = bankQueryResult.data;
      } else {
        bankErrorCode = "errorCode" in bankQueryResult ? bankQueryResult.errorCode : null;
        bankErrorMessage = "message" in bankQueryResult ? bankQueryResult.message : null;
      }
    }

    // 2. Bureau Mock Query or Reuse (if enabled)
    let bureauStatusVal: "SUCCESS" | "NO_DATA" | "UNAVAILABLE" | "ERROR" | null = null;
    let bureauResultId: string | null = null;
    let bureauPayload: NormalizedBureauData | null = null;
    let bureauErrorMessage: string | null = null;
    let bureauErrorCode: string | null = null;

    if (isBureauEnabled) {
      if (existingBureau && existingBureau.status === "SUCCESS") {
        bureauStatusVal = "SUCCESS";
        bureauResultId = existingBureau.id;
        bureauPayload = existingBureau.normalizedPayload as unknown as NormalizedBureauData;
      } else {
        const bureauQueryResult = await this.bureau.query(ctx.tenantId, documentNumber);
        bureauStatusVal = bureauQueryResult.status;
        const attemptCount = existingBureau ? existingBureau.attemptCount + 1 : 1;
        const id = existingBureau?.id ?? randomUUID();

        const persistedBureau = await this.db.client.evaluationSourceResult.upsert({
          where: { id },
          update: {
            status: bureauQueryResult.status,
            attemptCount,
            externalReference:
              "externalReference" in bureauQueryResult
                ? bureauQueryResult.externalReference
                : null,
            errorCode:
              "errorCode" in bureauQueryResult ? bureauQueryResult.errorCode : null,
            normalizedPayload:
              bureauQueryResult.status === "SUCCESS"
                ? (bureauQueryResult.data as unknown as object)
                : undefined,
            respondedAt: new Date(),
          },
          create: {
            id,
            tenantId: ctx.tenantId,
            evaluationId: evaluation.id,
            providerId: bureauQueryResult.providerId,
            status: bureauQueryResult.status,
            attemptCount: 1,
            externalReference:
              "externalReference" in bureauQueryResult
                ? bureauQueryResult.externalReference
                : null,
            errorCode:
              "errorCode" in bureauQueryResult ? bureauQueryResult.errorCode : null,
            normalizedPayload:
              bureauQueryResult.status === "SUCCESS"
                ? (bureauQueryResult.data as unknown as object)
                : undefined,
            respondedAt: new Date(),
          },
        });

        bureauResultId = persistedBureau.id;
        if (bureauQueryResult.status === "SUCCESS") {
          bureauPayload = bureauQueryResult.data;
        } else {
          bureauErrorCode =
            "errorCode" in bureauQueryResult ? bureauQueryResult.errorCode : null;
          bureauErrorMessage =
            "message" in bureauQueryResult ? bureauQueryResult.message : null;
        }
      }
    }

    // 3. Evaluate combined outcome (CA-15.06, CA-15.07, S3-RF-03)
    const isBankFailure = bankStatus === "UNAVAILABLE" || bankStatus === "ERROR";
    const isBureauFailure =
      isBureauEnabled &&
      (bureauStatusVal === "UNAVAILABLE" || bureauStatusVal === "ERROR");

    if (isBankFailure || isBureauFailure) {
      const failingSource = isBureauFailure ? "Buró de Crédito" : "Banco Unión";
      const failureCode =
        (isBureauFailure ? bureauErrorCode : bankErrorCode) ?? "SOURCE_UNAVAILABLE";
      const failureMessage =
        (isBureauFailure ? bureauErrorMessage : bankErrorMessage) ??
        `${failingSource} no está disponible temporalmente.`;

      const failed = await this.db.client.evaluation.update({
        where: { id: evaluation.id },
        data: {
          status: "FAILED",
          failureCode,
          failureMessage,
        },
        include: {
          client: true,
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

      await this.audit.recordEvaluationProcessed({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        evaluationId: evaluation.id,
        status: "FAILED",
      });

      return this.serializeEvaluation(failed);
    }

    const isBankNoData = bankStatus === "NO_DATA";
    const isBureauNoDataOrDisabled = !isBureauEnabled || bureauStatusVal === "NO_DATA";

    if (isBankNoData && isBureauNoDataOrDisabled) {
      const incomplete = await this.db.client.evaluation.update({
        where: { id: evaluation.id },
        data: {
          status: "INCOMPLETE",
          completedAt: new Date(),
          failureCode: "NO_FINANCIAL_DATA",
          failureMessage:
            "Sin antecedentes ni actividad financiera en las fuentes consultadas.",
        },
        include: {
          client: true,
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

      await this.audit.recordEvaluationProcessed({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        evaluationId: evaluation.id,
        status: "INCOMPLETE",
      });

      return this.serializeEvaluation(incomplete);
    }

    // At least one source has data: derive consolidated profile (CA-15.04, CA-15.06)
    const consolidated = this.profileCalculator.consolidate({
      bankData: bankPayload,
      bureauData: bureauPayload,
    });

    const sourceResultIds: string[] = [bankResultId];
    if (bureauResultId) {
      sourceResultIds.push(bureauResultId);
    }

    await this.profileCalculator.saveProfile(
      ctx.tenantId,
      evaluation.id,
      sourceResultIds,
      consolidated.indicators,
    );

    const applicantScope: "PERSON" | "COMPANY" =
      (evaluation.client?.type as "PERSON" | "COMPANY") ||
      snapshot?.type ||
      "PERSON";

    await this.recommender.evaluate(ctx.tenantId, evaluation.id, {
      applicantScope,
      purpose: evaluation.purpose,
      requestedAmount: Number(evaluation.requestedAmount),
      profile: consolidated.indicators,
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

    await this.audit.recordEvaluationProcessed({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      evaluationId: evaluation.id,
      status: "COMPLETED",
    });

    return this.serializeEvaluation(completed);
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
      provider?: { code: string; name: string } | null;
      status: string;
      attemptCount: number;
      externalReference: string | null;
      errorCode: string | null;
      requestedAt: Date;
      respondedAt: Date | null;
      normalizedPayload?: unknown;
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

    let indicatorProvenance: ProfileIndicatorProvenance | null = null;
    if (ev.profile) {
      const bankResult = ev.sourceResults?.find(
        (sr) => sr.provider?.code === "BANK_MOCK" && sr.status === "SUCCESS",
      );
      const bureauResult = ev.sourceResults?.find(
        (sr) => sr.provider?.code === "BUREAU_MOCK" && sr.status === "SUCCESS",
      );
      const bankData = (bankResult?.normalizedPayload as unknown as NormalizedFinancialData) ?? null;
      const bureauData = (bureauResult?.normalizedPayload as unknown as NormalizedBureauData) ?? null;
      indicatorProvenance = this.profileCalculator.consolidate({
        bankData,
        bureauData,
      }).provenance;
    }

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
            indicatorProvenance,
          }
        : null,
      sourceResults: (ev.sourceResults ?? []).map((sr) => ({
        id: sr.id,
        providerId: sr.providerId,
        providerCode: sr.provider?.code ?? (sr.providerId ? "SOURCE" : "UNKNOWN"),
        providerName: sr.provider?.name ?? "Fuente Financiera",
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

