import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { ClientsService } from "../clients/public.js";
import { TenantPreparationService, type TenantContext } from "../identity-tenants/public.js";
import { AuditWriter } from "../audit/public.js";
import {
  BankMockSource,
  BureauMockSource,
  sourceCoversSubject,
  type NormalizedFinancialData,
  type NormalizedBureauData,
  type SourceSubjectType,
} from "../financial-integrations/public.js";
import { ResilientSources } from "../financial-integrations/resilience/resilient-sources.js";
import {
  FinancialProfileCalculator,
  type ProfileIndicatorProvenance,
} from "../financial-profile/public.js";
import { EvaluationRecommender } from "../recommendations/public.js";
import type { CreateEvaluationDto, DocumentTypeDto, ClientTypeDto } from "./dto/create-evaluation.dto.js";
import type { DocumentType, CreditPurpose, ClientType, EvaluationStatus } from "../generated/prisma/client.js";
import {
  EVALUATION_LEASE_MS,
  buildCoverageCopy,
  computeTracking,
  effectiveIdempotencyKey,
  evaluateRetryPolicy,
  fingerprintEvaluationRequest,
  MAX_EVALUATION_RETRIES,
  isPrismaUniqueConflict,
  isRecordNotFound,
  sourceShouldBeRequeried,
  usageKeyForEvaluation,
} from "./evaluation.lifecycle.js";

export interface ListEvaluationsQuery {
  search?: string;
  status?: string;
  page?: number;
  limit?: number;
}

/** Producto y reglas congelados al evaluar (S4-HF-06). */
interface RecommendationProductSnapshot {
  name: string;
  category: string;
  minAmount: number;
  maxAmount: number;
}

function readProductSnapshot(value: unknown): RecommendationProductSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const snap = value as Record<string, unknown>;
  if (
    typeof snap.name !== "string" ||
    typeof snap.category !== "string" ||
    typeof snap.minAmount !== "number" ||
    typeof snap.maxAmount !== "number"
  ) {
    return null;
  }
  return {
    name: snap.name,
    category: snap.category,
    minAmount: snap.minAmount,
    maxAmount: snap.maxAmount,
  };
}

const COMPANY_DOCUMENT_MESSAGE =
  "Las empresas se identifican con NIT. Cambia el tipo de documento o registra al solicitante como persona.";

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
    private readonly resilient: ResilientSources,
  ) {}


  async checkReadiness(ctx: TenantContext) {
    return (await this.assessReadiness(ctx)).readiness;
  }

  /**
   * Preparación + cobertura por tipo de sujeto. Devuelve también si el Buró está
   * operativo para el tenant, de modo que el procesamiento no lo consulte dos veces.
   */
  private async assessReadiness(ctx: TenantContext) {
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

    // S4-HF-07: la cobertura sale de la declaración de las fuentes, no de suposiciones.
    const bureauStatus = await this.bureau.status(ctx.tenantId);
    const isBureauEnabled = Boolean(bureauStatus.enabled && bureauStatus.available);
    const bankCoversPerson = sourceCoversSubject("BANK_MOCK", "PERSON");
    const bankCoversCompany = sourceCoversSubject("BANK_MOCK", "COMPANY");

    const supportedApplicantTypes = {
      PERSON: {
        supported: isBankEnabled && bankCoversPerson && hasPersonProduct,
        reason: !isBankEnabled
          ? "La institución no tiene fuentes financieras habilitadas."
          : !bankCoversPerson
            ? "La fuente bancaria habilitada no cubre personas."
            : !hasPersonProduct
              ? "Tu institución no cuenta con productos crediticios activos para personas."
              : undefined,
      },
      COMPANY: {
        supported: isBankEnabled && bankCoversCompany && hasCompanyProduct,
        reason: !isBankEnabled
          ? isBureauEnabled && !sourceCoversSubject("BUREAU_MOCK", "COMPANY")
            ? "El Buró de Crédito habilitado solo cubre personas. Habilita una fuente bancaria con cobertura empresarial para evaluar empresas."
            : "No hay fuentes financieras habilitadas con cobertura empresarial para tu institución."
          : !bankCoversCompany
            ? "Ninguna fuente habilitada cubre empresas: la fuente bancaria solo cubre personas."
            : !hasCompanyProduct
              ? "Tu institución no cuenta con productos crediticios activos para empresas. Configura al menos un producto empresarial en la sección de Productos."
              : undefined,
      },
    };

    const statusObj = status as { ready?: boolean };
    const isReady =
      typeof statusObj.ready === "boolean" ? statusObj.ready : status.completed === 3;

    return {
      isBureauEnabled,
      readiness: {
        ready: isReady,
        completed: status.completed,
        percentage: status.percentage,
        steps: status.steps,
        tenantName: status.tenant?.name ?? "",
        supportedApplicantTypes,
      },
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
      if ((dto.documentType as unknown as string) !== "NIT") {
        throw new BadRequestException(COMPANY_DOCUMENT_MESSAGE);
      }
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

    const idempotencyKey = effectiveIdempotencyKey(
      ctx.tenantId,
      dto.idempotencyKey?.trim() || randomUUID(),
    );
    const requestFingerprint = fingerprintEvaluationRequest({
      clientType: clientType,
      documentType: dto.documentType,
      documentNumber: dto.documentNumber,
      name: dto.name,
      purpose: dto.purpose,
      requestedAmount: dto.requestedAmount,
    });

    const existing = await this.findByIdempotency(ctx.tenantId, idempotencyKey);
    if (existing) {
      return this.resolveIdempotentDraft(existing, requestFingerprint);
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

      try {
        const evaluation = await this.db.client.evaluation.create({
          data: {
            tenantId: ctx.tenantId,
            clientId: client.id,
            createdByMembershipId: ctx.membershipId,
            idempotencyKey,
            requestFingerprint,
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
      } catch (error) {
        if (!isPrismaUniqueConflict(error)) throw error;
        const raced = await this.findByIdempotency(ctx.tenantId, idempotencyKey);
        if (!raced) {
          throw new ConflictException("No se puede registrar esta solicitud.");
        }
        return this.resolveIdempotentDraft(raced, requestFingerprint);
      }
    });
  }

  async list(ctx: TenantContext, query?: ListEvaluationsQuery) {
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query?.limit) || 10));
    const skip = (page - 1) * limit;

    const where: {
      tenantId: string;
      status?: EvaluationStatus;
      OR?: Array<{
        client?: {
          name?: { contains: string; mode: "insensitive" };
          documentNumber?: { contains: string; mode: "insensitive" };
        };
      }>;
    } = {
      tenantId: ctx.tenantId,
    };

    if (query?.status && query.status !== "ALL") {
      where.status = query.status as EvaluationStatus;
    }

    if (query?.search && query.search.trim().length > 0) {
      const term = query.search.trim();
      where.OR = [
        { client: { name: { contains: term, mode: "insensitive" } } },
        { client: { documentNumber: { contains: term, mode: "insensitive" } } },
      ];
    }

    const [total, list] = await Promise.all([
      this.db.client.evaluation.count({ where }),
      this.db.client.evaluation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
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
      }),
    ]);

    const items = list.map((ev) => this.serializeEvaluation(ev));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
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

    // CA-11.19 / CA-15.09 / CA-25.12: COMPLETED never reconsults providers nor recalculates
    if (evaluation.status === "COMPLETED") {
      return this.serializeEvaluation(evaluation);
    }

    const now = new Date();
    const leaseActive =
      evaluation.status === "IN_PROGRESS" &&
      evaluation.leaseExpiresAt &&
      evaluation.leaseExpiresAt.getTime() > now.getTime();
    if (leaseActive) {
      return this.serializeEvaluation(evaluation);
    }

    const retryPolicy = evaluateRetryPolicy({
      status: evaluation.status,
      retryCount: evaluation.retryCount ?? 0,
      failureCode: evaluation.failureCode,
      sources: (evaluation.sourceResults ?? []).map((sr) => ({
        status: sr.status,
        errorCode: sr.errorCode,
      })),
    });
    if (evaluation.status === "FAILED" || evaluation.status === "INCOMPLETE") {
      if (!retryPolicy.allowed) {
        throw new BadRequestException(retryPolicy.reason);
      }
    }

    if (!evaluation.startedAt) {
      await this.consumeEvaluationUsage(ctx.tenantId, evaluation.id);
    }

    const { readiness, isBureauEnabled: isBureauOperational } = await this.assessReadiness(ctx);
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

    // S4-HF-07: revalidar la elegibilidad vigente antes de cambiar estado o consultar fuentes.
    const snapshot = evaluation.applicantSnapshot as Record<string, unknown> | null;
    const subject: SourceSubjectType =
      ((evaluation.client?.type ?? snapshot?.type) as SourceSubjectType | undefined) === "COMPANY"
        ? "COMPANY"
        : "PERSON";
    const subjectDocumentType = (evaluation.client?.documentType ??
      snapshot?.documentType) as string | undefined;
    if (subject === "COMPANY" && subjectDocumentType !== "NIT") {
      throw new BadRequestException(COMPANY_DOCUMENT_MESSAGE);
    }
    const subjectSupport = readiness.supportedApplicantTypes[subject];
    if (!subjectSupport.supported) {
      throw new BadRequestException(
        subjectSupport.reason ||
          "La institución ya no cumple las condiciones de cobertura para este tipo de solicitante.",
      );
    }

    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + EVALUATION_LEASE_MS);

    // CA-11.01 / CA-25.16 / OPS-04: transición condicional a IN_PROGRESS con lease.
    // Solo una réplica gana la carrera; la otra devuelve el estado persistido.
    const isRetryAttempt = evaluation.status === "FAILED" || evaluation.status === "INCOMPLETE";
    try {
      await this.db.client.evaluation.update({
        where: {
          id: evaluation.id,
          tenantId: ctx.tenantId,
          status: evaluation.status,
          leaseToken: evaluation.leaseToken ?? null,
        },
        data: {
          status: "IN_PROGRESS",
          startedAt: evaluation.startedAt ?? now,
          leaseToken,
          leaseExpiresAt,
          heartbeatAt: now,
          ...(isRetryAttempt
            ? { retryCount: { increment: 1 }, lastRetryAt: now, failureCode: null, failureMessage: null }
            : {}),
        },
      });
    } catch (error) {
      if (isRecordNotFound(error)) return this.getById(ctx, evaluation.id);
      throw error;
    }
    if (isRetryAttempt) {
      await this.audit.recordEvaluationRetry({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        evaluationId: evaluation.id,
        attempt: (evaluation.retryCount ?? 0) + 1,
      });
    }

    const documentNumber =
      evaluation.client?.documentNumber ?? (snapshot?.documentNumber as string);

    // Identify enabled sources for the tenant (CA-15.01, CA-15.02)
    // S4-HF-07: el Buró solo se consulta para los sujetos que realmente cubre.
    const isBureauEnabled = isBureauOperational && sourceCoversSubject("BUREAU_MOCK", subject);

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

    if (existingBank && !sourceShouldBeRequeried(existingBank.status, existingBank.errorCode)) {
      bankStatus = existingBank.status as typeof bankStatus;
      bankResultId = existingBank.id;
      bankPayload = existingBank.normalizedPayload as unknown as NormalizedFinancialData;
    } else {
      const bankQueryResult = await this.resilient.queryBank(
        bankProvider?.id,
        ctx.tenantId,
        documentNumber,
        subject,
      );
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
      if (existingBureau && !sourceShouldBeRequeried(existingBureau.status, existingBureau.errorCode)) {
        bureauStatusVal = existingBureau.status as "SUCCESS" | "NO_DATA" | "UNAVAILABLE" | "ERROR";
        bureauResultId = existingBureau.id;
        bureauPayload = existingBureau.normalizedPayload as unknown as NormalizedBureauData;
      } else {
        const bureauQueryResult = await this.resilient.queryBureau(
          bureauProvider?.id,
          ctx.tenantId,
          documentNumber,
        );
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
      const hasSuccessfulSource = bankStatus === "SUCCESS" || bureauStatusVal === "SUCCESS";
      const failingSource = isBureauFailure ? "Buró crediticio" : "Banco Mock";
      const failureCode = hasSuccessfulSource
        ? "PARTIAL_SOURCE_FAILURE"
        : ((isBureauFailure ? bureauErrorCode : bankErrorCode) ?? "SOURCE_UNAVAILABLE");
      const failureMessage = hasSuccessfulSource
        ? `${failingSource} no respondió por ahora. Se conservan los datos ya obtenidos.`
        : ((isBureauFailure ? bureauErrorMessage : bankErrorMessage) ??
          `${failingSource} no está disponible temporalmente.`);

      const failed = await this.finalizeEvaluation(evaluation.id, leaseToken, {
        status: hasSuccessfulSource ? "INCOMPLETE" : "FAILED",
        failureCode,
        failureMessage,
      });
      if (!failed) {
        return this.getById(ctx, evaluation.id);
      }

      const persisted = failed;
      await this.audit.recordEvaluationProcessed({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        evaluationId: evaluation.id,
        status: persisted.status,
      });

      return this.serializeEvaluation(persisted);
    }

    const isBankNoData = bankStatus === "NO_DATA";
    const isBureauNoDataOrDisabled = !isBureauEnabled || bureauStatusVal === "NO_DATA";

    if (isBankNoData && isBureauNoDataOrDisabled) {
      const incomplete = await this.finalizeEvaluation(evaluation.id, leaseToken, {
        status: "INCOMPLETE",
        completedAt: new Date(),
        failureCode: "NO_FINANCIAL_DATA",
        failureMessage: "Sin antecedentes ni actividad financiera en las fuentes consultadas.",
      });
      if (!incomplete) {
        return this.getById(ctx, evaluation.id);
      }

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

    const applicantScope: SourceSubjectType = subject;

    // S4-HF-06: perfil, recomendaciones congeladas, cierre y auditoría se confirman
    // juntos; las consultas a fuentes ya terminaron fuera de esta transacción.
    return this.db.run(async () => {
      await this.profileCalculator.saveProfile(
        ctx.tenantId,
        evaluation.id,
        sourceResultIds,
        consolidated.indicators,
      );

      await this.recommender.evaluate(ctx.tenantId, evaluation.id, {
        applicantScope,
        purpose: evaluation.purpose,
        requestedAmount: Number(evaluation.requestedAmount),
        profile: consolidated.indicators,
      });

      const completed = await this.finalizeEvaluation(evaluation.id, leaseToken, {
        status: "COMPLETED",
        ruleVersion: "1.0.0",
        completedAt: new Date(),
        failureCode: null,
        failureMessage: null,
      });
      if (!completed) {
        return this.getById(ctx, evaluation.id);
      }

      await this.audit.recordEvaluationProcessed({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        evaluationId: evaluation.id,
        status: "COMPLETED",
      });

      return this.serializeEvaluation(completed);
    });
  }

  private evaluationInclude() {
    return {
      client: true,
      profile: true,
      sourceResults: { include: { provider: true }, orderBy: { requestedAt: "asc" as const } },
      recommendations: {
        include: { product: true, reasons: true },
        orderBy: { evaluatedAt: "asc" as const },
      },
    };
  }

  private async findByIdempotency(tenantId: string, effectiveKey: string) {
    return this.db.client.evaluation.findFirst({
      where: { tenantId, idempotencyKey: effectiveKey },
      include: this.evaluationInclude(),
    });
  }

  /** CA-25.01 / CA-25.14: misma clave+payload => misma Evaluation; payload distinto => 409 genérico. */
  private resolveIdempotentDraft(
    existing: Parameters<EvaluationsService["serializeEvaluation"]>[0] & {
      requestFingerprint?: string | null;
    },
    requestFingerprint: string,
  ) {
    if (existing.requestFingerprint && existing.requestFingerprint !== requestFingerprint) {
      throw new ConflictException("No se puede registrar esta solicitud.");
    }
    return this.serializeEvaluation(existing);
  }

  /**
   * CA-25.10: consumo exactamente una vez por Evaluation. Bloqueo advisory por tenant
   * dentro de una transacción: la cuota estricta no se excede bajo carrera.
   */
  private async consumeEvaluationUsage(tenantId: string, evaluationId: string): Promise<void> {
    await this.db.run(async () => {
      const client = this.db.client;
      await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${tenantId}))`;

      const key = usageKeyForEvaluation(tenantId, evaluationId);
      const already = await client.usageRecord.findUnique({ where: { idempotencyKey: key } });
      if (already) return;

      const subscription = await client.tenantSubscription.findFirst({
        where: { tenantId, status: "ACTIVE" },
        include: { plan: true },
        orderBy: { startsAt: "desc" },
      });
      const limit = subscription?.plan?.evaluationsPerMonth ?? null;
      if (limit !== null) {
        const nowUtc = new Date();
        const monthStart = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), 1));
        const used = await client.usageRecord.count({
          where: { tenantId, metric: "EVALUATION", occurredAt: { gte: monthStart } },
        });
        if (used >= limit) {
          throw new ForbiddenException(
            "Tu institución alcanzó el límite mensual de evaluaciones de su plan.",
          );
        }
      }

      try {
        await client.usageRecord.create({
          data: {
            tenantId,
            metric: "EVALUATION",
            quantity: 1,
            referenceType: "Evaluation",
            referenceId: evaluationId,
            idempotencyKey: key,
          },
        });
      } catch (error) {
        if (!isPrismaUniqueConflict(error)) throw error;
      }
    });
  }

  /** CA-25.16: solo el dueño del lease y solo desde IN_PROGRESS puede cerrar. */
  private async finalizeEvaluation(
    evaluationId: string,
    leaseToken: string,
    data: {
      status: EvaluationStatus;
      failureCode?: string | null;
      failureMessage?: string | null;
      completedAt?: Date | null;
      ruleVersion?: string | null;
    },
  ) {
    try {
      return await this.db.client.evaluation.update({
        where: { id: evaluationId, leaseToken, status: "IN_PROGRESS" },
        data: { ...data, leaseToken: null, leaseExpiresAt: null, heartbeatAt: null },
        include: this.evaluationInclude(),
      });
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /** CA-25.06 / CA-25.09 / CA-25.15: reintenta la misma Evaluation, sin nuevo consumo. */
  async retryEvaluation(ctx: TenantContext, evaluationId: string) {
    const evaluation = await this.db.client.evaluation.findFirst({
      where: { id: evaluationId, tenantId: ctx.tenantId },
      include: this.evaluationInclude(),
    });
    if (!evaluation) throw new NotFoundException("Evaluación no encontrada.");

    const snapshot = evaluation.applicantSnapshot as {
      id?: string;
      documentNumber?: string;
      consent?: { given?: boolean };
    } | null;
    const sameSubject =
      !!snapshot &&
      snapshot.consent?.given === true &&
      !!evaluation.consentGivenAt &&
      snapshot.id === evaluation.clientId &&
      (!evaluation.client || snapshot.documentNumber === evaluation.client.documentNumber);
    if (!sameSubject) {
      throw new BadRequestException(
        "El consentimiento original no corresponde al solicitante de esta evaluación.",
      );
    }

    const policy = evaluateRetryPolicy({
      status: evaluation.status,
      retryCount: evaluation.retryCount ?? 0,
      failureCode: evaluation.failureCode,
      sources: (evaluation.sourceResults ?? []).map((sr) => ({
        status: sr.status,
        errorCode: sr.errorCode,
      })),
    });
    if (!policy.allowed) throw new BadRequestException(policy.reason);

    return this.processEvaluation(ctx, evaluationId);
  }

  /** CA-25.02/.11/.13/.17: estado persistido + seguimiento + qué se logró/qué faltó/qué hacer. */
  private buildRecoveryView(ev: {
    status: string;
    failureCode?: string | null;
    retryCount?: number;
    leaseExpiresAt?: Date | null;
    sourceResults?: Array<{
      status: string;
      errorCode: string | null;
      respondedAt: Date | null;
      requestedAt: Date;
      provider?: { code: string; name: string } | null;
    }>;
  }) {
    const sources = (ev.sourceResults ?? []).map((sr) => ({
      providerCode: sr.provider?.code ?? null,
      providerName: sr.provider?.name ?? null,
      status: sr.status,
      errorCode: sr.errorCode,
    }));
    const policy = evaluateRetryPolicy({
      status: ev.status,
      retryCount: ev.retryCount ?? 0,
      failureCode: ev.failureCode,
      sources,
    });
    return {
      tracking: computeTracking({
        status: ev.status,
        leaseExpiresAt: ev.leaseExpiresAt,
        retryable: policy.allowed,
      }),
      retry: {
        allowed: policy.allowed,
        reason: policy.reason,
        remainingAttempts: policy.remainingAttempts,
        maxAttempts: MAX_EVALUATION_RETRIES,
      },
      coverage: buildCoverageCopy(sources),
      sourceStatuses: (ev.sourceResults ?? []).map((sr) => ({
        providerCode: sr.provider?.code ?? null,
        providerName: sr.provider?.name ?? null,
        status: sr.status,
        errorCode: sr.errorCode,
        asOf: sr.respondedAt ?? sr.requestedAt,
      })),
    };
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
    retryCount?: number;
    leaseExpiresAt?: Date | null;
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
      productSnapshot?: unknown;
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
      ...this.buildRecoveryView(ev),
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
      recommendations: (ev.recommendations ?? []).map((r) => {
        const hasVerifiedFailure = (r.reasons ?? []).some(
          (reas) =>
            !reas.passed &&
            !reas.code.includes("NOT_EVALUABLE") &&
            !reas.code.includes("UNVERIFIED"),
        );
        const hasUnevaluable = (r.reasons ?? []).some(
          (reas) =>
            reas.code.includes("NOT_EVALUABLE") ||
            reas.code.includes("UNVERIFIED"),
        );

        let outcome = r.outcome;
        let compatibilityStatus: "COMPATIBLE" | "INCOMPATIBLE" | "NOT_EVALUABLE" =
          r.outcome === "RECOMMENDED" ? "COMPATIBLE" : "INCOMPATIBLE";

        if (r.outcome !== "RECOMMENDED") {
          if (!hasVerifiedFailure && hasUnevaluable) {
            outcome = "NOT_EVALUABLE";
            compatibilityStatus = "NOT_EVALUABLE";
          }
        }

        // S4-HF-06: el snapshot manda; las filas anteriores al hotfix usan el producto vinculado.
        const frozen = readProductSnapshot(r.productSnapshot);

        return {
          id: r.id,
          productId: r.productId,
          productName: frozen?.name ?? r.product?.name ?? "Producto",
          category: frozen?.category ?? r.product?.category ?? "MICRO_CREDIT",
          outcome,
          compatibilityStatus,
          ruleVersion: r.ruleVersion,
          minAmount:
            frozen?.minAmount ??
            (r.product?.minAmount !== undefined ? Number(r.product.minAmount) : 0),
          maxAmount:
            frozen?.maxAmount ??
            (r.product?.maxAmount !== undefined ? Number(r.product.maxAmount) : 0),
          evaluatedAt: r.evaluatedAt,
          reasons: (r.reasons ?? []).map((reas) => ({
            code: reas.code,
            message: reas.message,
            passed: reas.passed,
            status: (reas.code.includes("NOT_EVALUABLE") || reas.code.includes("UNVERIFIED")
              ? "NOT_EVALUABLE"
              : reas.passed
                ? "PASSED"
                : "FAILED") as "PASSED" | "FAILED" | "NOT_EVALUABLE",
          })),
        };
      }),
    };
  }
}
