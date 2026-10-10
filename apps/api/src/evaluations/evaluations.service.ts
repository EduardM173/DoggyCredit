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
import type { CreateEvaluationDto, DocumentTypeDto } from "./dto/create-evaluation.dto.js";
import type { DocumentType, CreditPurpose } from "../generated/prisma/client.js";

@Injectable()
export class EvaluationsService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly clients: ClientsService,
    private readonly preparation: TenantPreparationService,
    private readonly audit: AuditWriter,
  ) {}

  async checkReadiness(ctx: TenantContext) {
    const status = await this.preparation.read(ctx);
    return {
      ready: status.ready,
      completed: status.completed,
      percentage: status.percentage,
      steps: status.steps,
      tenantName: status.tenant.name,
    };
  }

  async searchClient(
    ctx: TenantContext,
    documentType: DocumentTypeDto | DocumentType,
    documentNumber: string,
  ) {
    const client = await this.clients.findByDocument(
      ctx.tenantId,
      documentType as unknown as DocumentType,
      documentNumber,
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

    if (!dto.consentGiven) {
      throw new BadRequestException(
        "Se requiere el consentimiento del solicitante para preparar la evaluación.",
      );
    }

    const idempotencyKey = dto.idempotencyKey?.trim() || randomUUID();

    const existing = await this.db.client.evaluation.findUnique({
      where: { idempotencyKey },
      include: { client: true },
    });
    if (existing) {
      if (existing.tenantId !== ctx.tenantId) {
        throw new ForbiddenException("No tienes acceso a esta evaluación.");
      }
      return this.serializeEvaluation(existing);
    }

    return this.db.run(async () => {
      const { client } = await this.clients.findOrCreate(ctx.tenantId, {
        type: "PERSON",
        documentType: dto.documentType as unknown as DocumentType,
        documentNumber: dto.documentNumber,
        name: dto.name,
      });

      const now = new Date();
      const applicantSnapshot = {
        id: client.id,
        type: client.type,
        documentType: client.documentType,
        documentNumber: client.documentNumber,
        name: client.name,
        consent: {
          given: true,
          timestamp: now.toISOString(),
          actorMembershipId: ctx.membershipId,
          actorName: ctx.userName,
          actorUserId: ctx.userId,
          statement:
            "El solicitante autoriza la consulta y verificación de su información financiera para fines de evaluación crediticia.",
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
        include: { client: true },
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
      include: { client: true },
    });
    return list.map((ev) => this.serializeEvaluation(ev));
  }

  async getById(ctx: TenantContext, evaluationId: string) {
    const evaluation = await this.db.client.evaluation.findFirst({
      where: { id: evaluationId, tenantId: ctx.tenantId },
      include: { client: true, profile: true, recommendations: true },
    });
    if (!evaluation) {
      throw new NotFoundException("Evaluación no encontrada.");
    }
    return this.serializeEvaluation(evaluation);
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
    createdAt: Date;
    updatedAt: Date;
  }) {
    const snapshot = ev.applicantSnapshot as Record<string, unknown> | null;
    return {
      id: ev.id,
      tenantId: ev.tenantId,
      clientId: ev.clientId,
      clientName: ev.client?.name ?? snapshot?.name ?? "Solicitante",
      documentType: ev.client?.documentType ?? snapshot?.documentType ?? "CI",
      documentNumber: ev.client?.documentNumber ?? snapshot?.documentNumber ?? "",
      purpose: ev.purpose,
      requestedAmount: Number(ev.requestedAmount),
      status: ev.status,
      consentGivenAt: ev.consentGivenAt,
      applicantSnapshot: ev.applicantSnapshot,
      ruleVersion: ev.ruleVersion,
      createdAt: ev.createdAt,
      updatedAt: ev.updatedAt,
    };
  }
}
