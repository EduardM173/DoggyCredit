import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
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
  sourceCoversSubject,
  type NormalizedFinancialData,
  type NormalizedBureauData,
  type SourceSubjectType,
} from "../financial-integrations/public.js";
import { ResilientSources } from "../financial-integrations/public.js";
import {
  FinancialProfileCalculator,
  type ProfileIndicatorProvenance,
} from "../financial-profile/public.js";
import { EvaluationRecommender } from "../recommendations/public.js";
import {
  ClientTypeDto,
  CreditPurposeDto,
  DocumentTypeDto,
  type CreateEvaluationDto,
} from "./dto/create-evaluation.dto.js";
import type {
  DocumentType,
  CreditPurpose,
  ClientType,
  EvaluationStatus,
} from "../generated/prisma/client.js";

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

type EvaluationFingerprintInput = Pick<
  CreateEvaluationDto,
  | "clientType"
  | "documentType"
  | "documentNumber"
  | "name"
  | "economicActivity"
  | "purpose"
  | "requestedAmount"
  | "consentGiven"
>;

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function evaluationFingerprint(input: EvaluationFingerprintInput) {
  const canonicalPayload = JSON.stringify({
    operation: "evaluation.create",
    clientType: input.clientType ?? "PERSON",
    documentType: input.documentType,
    documentNumber: input.documentNumber.trim(),
    name: normalizeName(input.name),
    economicActivity: input.economicActivity?.trim() || null,
    purpose: input.purpose,
    requestedAmount: Number(input.requestedAmount).toFixed(2),
    consentGiven: input.consentGiven,
  });
  return createHash("sha256").update(canonicalPayload).digest("hex");
}

function prismaErrorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
}

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

  private async assertActiveSubscription(tenantId: string) {
    const now = new Date();
    const subscription = await this.db.client.tenantSubscription.findFirst({
      where: {
        tenantId,
        status: "ACTIVE",
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
        plan: { active: true },
      },
      select: { id: true },
    });
    if (!subscription) {
      throw new ForbiddenException(
        "La institución no tiene una suscripción activa para iniciar evaluaciones.",
      );
    }
  }

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
        ? products.some((p) => p.selected && (p.applicantScope === "COMPANY" || p.applicantScope === "BOTH"))
        : false;

    const hasPersonProduct =
      products.length > 0
        ? products.some((p) => p.selected && (p.applicantScope === "PERSON" || p.applicantScope === "BOTH"))
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
    const isReady = typeof statusObj.ready === "boolean" ? statusObj.ready : status.completed === 3;

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
    const clientType = (dto.clientType as unknown as ClientType) || "PERSON";
    if (clientType === "COMPANY") {
      if ((dto.documentType as unknown as string) !== "NIT") {
        throw new BadRequestException(COMPANY_DOCUMENT_MESSAGE);
      }
    }

    if (!dto.consentGiven) {
      throw new BadRequestException(
        "Se requiere el consentimiento del solicitante para preparar la evaluación.",
      );
    }

    const idempotencyKey = dto.idempotencyKey?.trim();
    if (!idempotencyKey || idempotencyKey.length < 16) {
      throw new BadRequestException("La clave de operación es obligatoria para iniciar una evaluación.");
    }
    const requestFingerprint = evaluationFingerprint({
      ...dto,
      clientType: clientType as unknown as ClientTypeDto,
    });

    const loadExisting = async () => {
      const existing = await this.db.client.evaluation.findUnique({
        where: {
          tenantId_idempotencyKey: { tenantId: ctx.tenantId, idempotencyKey },
        },
        include: { client: true, profile: true, sourceResults: true },
      });
      if (!existing) return null;

      const snapshot = existing.applicantSnapshot as Record<string, unknown> | null;
      const persistedFingerprint =
        existing.requestFingerprint ??
        (snapshot && typeof snapshot.name === "string"
          ? evaluationFingerprint({
              clientType: (snapshot.type as ClientTypeDto) ?? ClientTypeDto.PERSON,
              documentType:
                (snapshot.documentType as DocumentTypeDto | undefined) ??
                (existing.client.documentType as DocumentTypeDto),
              documentNumber: (snapshot.documentNumber as string) ?? existing.client.documentNumber,
              name: snapshot.name,
              economicActivity:
                typeof snapshot.economicActivity === "string" ? snapshot.economicActivity : undefined,
              purpose: existing.purpose as CreditPurposeDto,
              requestedAmount: Number(existing.requestedAmount),
              consentGiven: Boolean(existing.consentGivenAt),
            })
          : null);

      if (persistedFingerprint !== requestFingerprint) {
        throw new ConflictException(
          "La clave de operación ya se utilizó con otros datos. Inicia una nueva evaluación para esta solicitud.",
        );
      }
      if (!existing.requestFingerprint) {
        await this.db.client.evaluation.updateMany({
          where: { id: existing.id, tenantId: ctx.tenantId, requestFingerprint: null },
          data: { requestFingerprint },
        });
      }
      return existing;
    };

    const existing = await loadExisting();
    if (existing) return this.serializeEvaluation(existing);

    await this.assertActiveSubscription(ctx.tenantId);
    const readiness = await this.checkReadiness(ctx);
    if (!readiness.ready) {
      throw new BadRequestException(
        "La institución no ha completado la preparación requerida (fuentes y productos) para realizar evaluaciones.",
      );
    }
    const subjectSupport = readiness.supportedApplicantTypes[clientType];
    if (!subjectSupport.supported) {
      throw new BadRequestException(
        subjectSupport.reason ||
          `La evaluación de ${clientType === "COMPANY" ? "empresas" : "personas"} no está admitida en esta institución por la cobertura vigente.`,
      );
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.db.run(async () => {
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
        });
      } catch (error) {
        const code = prismaErrorCode(error);
        if (code !== "P2002" && code !== "P2034") throw error;
        const winner = await loadExisting();
        if (winner) return this.serializeEvaluation(winner);
        if (attempt === 2) throw error;
      }
    }
    throw new ConflictException("No se pudo reservar la operación. Inténtalo nuevamente.");
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

    // CA-11.19 / CA-15.09: If already COMPLETED, return current state without creating a duplicate
    if (evaluation.status === "COMPLETED") {
      return this.serializeEvaluation(evaluation);
    }
    if (evaluation.status === "IN_PROGRESS") {
      return this.serializeEvaluation(evaluation);
    }

    await this.assertActiveSubscription(ctx.tenantId);

    const { readiness, isBureauEnabled: isBureauOperational } = await this.assessReadiness(ctx);
    if (!readiness.ready) {
      throw new BadRequestException("La institución no cumple las condiciones mínimas para evaluar.");
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
    const subjectDocumentType = (evaluation.client?.documentType ?? snapshot?.documentType) as
      string | undefined;
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

    // A conditional write is the cross-instance claim; only one request may process this attempt.
    const claim = await this.db.client.evaluation.updateMany({
      where: {
        id: evaluation.id,
        tenantId: ctx.tenantId,
        status: evaluation.status,
      },
      data: {
        status: "IN_PROGRESS",
        startedAt: evaluation.startedAt ?? new Date(),
      },
    });
    if (claim.count !== 1) {
      const current = await this.db.client.evaluation.findFirst({
        where: { id: evaluation.id, tenantId: ctx.tenantId },
        include: {
          client: true,
          profile: true,
          sourceResults: { include: { provider: true }, orderBy: { requestedAt: "asc" } },
          recommendations: { include: { product: true, reasons: true }, orderBy: { evaluatedAt: "asc" } },
        },
      });
      if (!current) throw new NotFoundException("Evaluación no encontrada.");
      return this.serializeEvaluation(current);
    }

    try {
      const documentNumber = evaluation.client?.documentNumber ?? (snapshot?.documentNumber as string);

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
        (sr) => sr.provider?.code === "BANK_MOCK" || (bankProvider && sr.providerId === bankProvider.id),
      );
      const existingBureau = isBureauEnabled
        ? (evaluation.sourceResults ?? []).find(
            (sr) =>
              sr.provider?.code === "BUREAU_MOCK" || (bureauProvider && sr.providerId === bureauProvider.id),
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
              bankQueryResult.status === "SUCCESS" ? (bankQueryResult.data as unknown as object) : undefined,
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
              bankQueryResult.status === "SUCCESS" ? (bankQueryResult.data as unknown as object) : undefined,
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
                "externalReference" in bureauQueryResult ? bureauQueryResult.externalReference : null,
              errorCode: "errorCode" in bureauQueryResult ? bureauQueryResult.errorCode : null,
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
                "externalReference" in bureauQueryResult ? bureauQueryResult.externalReference : null,
              errorCode: "errorCode" in bureauQueryResult ? bureauQueryResult.errorCode : null,
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
            bureauErrorCode = "errorCode" in bureauQueryResult ? bureauQueryResult.errorCode : null;
            bureauErrorMessage = "message" in bureauQueryResult ? bureauQueryResult.message : null;
          }
        }
      }

      // 3. Evaluate combined outcome (CA-15.06, CA-15.07, S3-RF-03)
      const isBankFailure = bankStatus === "UNAVAILABLE" || bankStatus === "ERROR";
      const isBureauFailure =
        isBureauEnabled && (bureauStatusVal === "UNAVAILABLE" || bureauStatusVal === "ERROR");

      if (isBankFailure || isBureauFailure) {
        const failingSource = isBureauFailure ? "Buró de Crédito" : "Banco Unión";
        const failureCode = (isBureauFailure ? bureauErrorCode : bankErrorCode) ?? "SOURCE_UNAVAILABLE";
        const failureMessage =
          (isBureauFailure ? bureauErrorMessage : bankErrorMessage) ??
          `${failingSource} no está disponible temporalmente.`;

        const failed = await this.db.run(async () => {
          const result = await this.db.client.evaluation.update({
            where: { id: evaluation.id },
            data: { status: "FAILED", failureCode, failureMessage },
            include: {
              client: true,
              profile: true,
              sourceResults: { include: { provider: true }, orderBy: { requestedAt: "asc" } },
              recommendations: { include: { product: true, reasons: true }, orderBy: { evaluatedAt: "asc" } },
            },
          });
          await this.audit.recordEvaluationProcessed({
            tenantId: ctx.tenantId,
            actorUserId: ctx.userId,
            evaluationId: evaluation.id,
            status: "FAILED",
          });
          return result;
        });

        return this.serializeEvaluation(failed);
      }

      const isBankNoData = bankStatus === "NO_DATA";
      const isBureauNoDataOrDisabled = !isBureauEnabled || bureauStatusVal === "NO_DATA";

      if (isBankNoData && isBureauNoDataOrDisabled) {
        const incomplete = await this.db.run(async () => {
          const result = await this.db.client.evaluation.update({
            where: { id: evaluation.id },
            data: {
              status: "INCOMPLETE",
              completedAt: new Date(),
              failureCode: "NO_FINANCIAL_DATA",
              failureMessage: "Sin antecedentes ni actividad financiera en las fuentes consultadas.",
            },
            include: {
              client: true,
              profile: true,
              sourceResults: { include: { provider: true }, orderBy: { requestedAt: "asc" } },
              recommendations: { include: { product: true, reasons: true }, orderBy: { evaluatedAt: "asc" } },
            },
          });
          await this.audit.recordEvaluationProcessed({
            tenantId: ctx.tenantId,
            actorUserId: ctx.userId,
            evaluationId: evaluation.id,
            status: "INCOMPLETE",
          });
          return result;
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
      return await this.db.run(async () => {
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

        await this.db.client.usageRecord.create({
          data: {
            tenantId: ctx.tenantId,
            metric: "EVALUATION",
            quantity: 1,
            referenceType: "Evaluation",
            referenceId: evaluation.id,
            idempotencyKey: `evaluation-completed/${evaluation.id}`,
          },
        });

        await this.audit.recordEvaluationProcessed({
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          evaluationId: evaluation.id,
          status: "COMPLETED",
        });

        return this.serializeEvaluation(completed);
      });
    } catch (error) {
      const current = await this.db.client.evaluation.findFirst({
        where: { id: evaluation.id, tenantId: ctx.tenantId },
        include: {
          client: true,
          profile: true,
          sourceResults: { include: { provider: true }, orderBy: { requestedAt: "asc" } },
          recommendations: { include: { product: true, reasons: true }, orderBy: { evaluatedAt: "asc" } },
        },
      });
      if (!current) throw error;
      if (current.status !== "IN_PROGRESS") return this.serializeEvaluation(current);

      await this.db.run(async () => {
        const released = await this.db.client.evaluation.updateMany({
          where: { id: evaluation.id, tenantId: ctx.tenantId, status: "IN_PROGRESS" },
          data: {
            status: "FAILED",
            failureCode: "EVALUATION_PROCESSING_ERROR",
            failureMessage: "No se pudo completar técnicamente. Puedes reintentar esta evaluación.",
          },
        });
        if (released.count === 1) {
          await this.audit.recordEvaluationProcessed({
            tenantId: ctx.tenantId,
            actorUserId: ctx.userId,
            evaluationId: evaluation.id,
            status: "FAILED",
          });
        }
      });
      const recovered = await this.db.client.evaluation.findFirst({
        where: { id: evaluation.id, tenantId: ctx.tenantId },
        include: {
          client: true,
          profile: true,
          sourceResults: { include: { provider: true }, orderBy: { requestedAt: "asc" } },
          recommendations: { include: { product: true, reasons: true }, orderBy: { evaluatedAt: "asc" } },
        },
      });
      if (recovered) return this.serializeEvaluation(recovered);
      throw error;
    }
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
      profile: ev.profile
        ? {
            id: ev.profile.id,
            averageMonthlyIncome:
              ev.profile.averageMonthlyIncome !== null ? Number(ev.profile.averageMonthlyIncome) : null,
            averageMonthlyExpenses:
              ev.profile.averageMonthlyExpenses !== null ? Number(ev.profile.averageMonthlyExpenses) : null,
            disposableIncome:
              ev.profile.disposableIncome !== null ? Number(ev.profile.disposableIncome) : null,
            totalDebt: ev.profile.totalDebt !== null ? Number(ev.profile.totalDebt) : null,
            activeCredits: ev.profile.activeCredits,
            debtToIncome: ev.profile.debtToIncome !== null ? Number(ev.profile.debtToIncome) : null,
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
          (reas) => !reas.passed && !reas.code.includes("NOT_EVALUABLE") && !reas.code.includes("UNVERIFIED"),
        );
        const hasUnevaluable = (r.reasons ?? []).some(
          (reas) => reas.code.includes("NOT_EVALUABLE") || reas.code.includes("UNVERIFIED"),
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
            frozen?.minAmount ?? (r.product?.minAmount !== undefined ? Number(r.product.minAmount) : 0),
          maxAmount:
            frozen?.maxAmount ?? (r.product?.maxAmount !== undefined ? Number(r.product.maxAmount) : 0),
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
