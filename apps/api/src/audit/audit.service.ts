import { Injectable } from "@nestjs/common";
import type { Prisma } from "../generated/prisma/client.js";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { AuditWriter, type RequestDecisionEvent, type CommerceAuditEvent } from "./public.js";

@Injectable()
export class AuditService extends AuditWriter {
  async recordTeamInvitation(event: {
    tenantId: string;
    actorUserId: string;
    invitationId: string;
    action:
      | "ANALYST_INVITATION_CREATED"
      | "ANALYST_INVITATION_RESENT"
      | "ADMIN_INVITATION_CREATED"
      | "ADMIN_INVITATION_RESENT";
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorUserId: event.actorUserId,
        action: event.action,
        entityType: "MembershipInvitation",
        entityId: event.invitationId,
      },
    });
  }
  async recordTeamAccess(event: {
    tenantId: string;
    actorUserId: string;
    membershipId: string;
    action: "INVITATION_CANCELLED" | "MEMBERSHIP_SUSPENDED" | "MEMBERSHIP_REACTIVATED" | "MEMBERSHIP_REVOKED";
    fromStatus: string;
    toStatus: string;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorUserId: event.actorUserId,
        action: event.action,
        entityType: "TenantMembership",
        entityId: event.membershipId,
        metadata: { fromStatus: event.fromStatus, toStatus: event.toStatus },
      },
    });
  }
  async recordInstitutionPreparation(event: {
    tenantId: string;
    actorUserId: string;
    action:
      | "INSTITUTION_INFORMATION_CONFIRMED"
      | "BANK_MOCK_ENABLED"
      | "BUREAU_MOCK_ENABLED"
      | "BUREAU_MOCK_DISABLED"
      | "INSTITUTION_PRODUCTS_CONFIRMED"
      | "INSTITUTION_PREPARED";
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorUserId: event.actorUserId,
        action: event.action,
        entityType: "Tenant",
        entityId: event.tenantId,
      },
    });
  }
  async recordProviderAdministration(event: {
    actorUserId: string;
    providerId: string;
    providerCode: string;
    action: "PROVIDER_GLOBALLY_ENABLED" | "PROVIDER_GLOBALLY_DISABLED";
    previousEnabled: boolean;
    currentEnabled: boolean;
    reason?: string;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        // Evento de plataforma: no pertenece a ninguna institución.
        tenantId: null,
        actorUserId: event.actorUserId,
        action: event.action,
        entityType: "IntegrationProvider",
        entityId: event.providerId,
        // Sin URLs, claves ni datos de solicitantes: solo el cambio y su motivo.
        metadata: {
          providerCode: event.providerCode,
          previousEnabled: event.previousEnabled,
          currentEnabled: event.currentEnabled,
          ...(event.reason ? { reason: event.reason } : {}),
        },
      },
    });
  }
    async recordProviderHealthTransition(event: {
    providerId: string;
    providerCode: string;
    action: "PROVIDER_DEGRADED" | "PROVIDER_RECOVERED";
    from: string;
    to: string;
    episodeId: string;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: null,
        actorUserId: null,
        action: event.action,
        entityType: "IntegrationProvider",
        entityId: event.providerId,
        // Lista blanca: sin PII, URLs, secretos ni payloads.
        metadata: {
          providerCode: event.providerCode,
          from: event.from,
          to: event.to,
          episodeId: event.episodeId,
        },
      },
    });
  }

  async findOpenProviderEpisode(
    providerId: string,
  ): Promise<{ episodeId: string; startedAt: Date } | null> {
    const last = await this.database.client.auditLog.findFirst({
      where: {
        entityType: "IntegrationProvider",
        entityId: providerId,
        action: { in: ["PROVIDER_DEGRADED", "PROVIDER_RECOVERED"] },
      },
      orderBy: { createdAt: "desc" },
      select: { action: true, createdAt: true, metadata: true },
    });
    if (!last || last.action !== "PROVIDER_DEGRADED") return null;
    const episodeId = (last.metadata as { episodeId?: unknown } | null)?.episodeId;
    return typeof episodeId === "string" ? { episodeId, startedAt: last.createdAt } : null;
  }
  async recordMembershipActivation(event: {
    userId: string;
    tenantId: string;
    membershipId: string;
    invitationId: string;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorUserId: event.userId,
        action: "MEMBERSHIP_ACTIVATED",
        entityType: "TenantMembership",
        entityId: event.membershipId,
        metadata: { invitationId: event.invitationId },
      },
    });
  }
  async recordProvisioning(event: {
    tenantId: string;
    contractingId: string;
    membershipId: string;
    planId: string;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorUserId: null,
        action: "TENANT_PROVISIONED",
        entityType: "Tenant",
        entityId: event.tenantId,
        metadata: {
          actorKind: "SYSTEM",
          contractingId: event.contractingId,
          membershipId: event.membershipId,
          planId: event.planId,
        },
      },
    });
  }
  async recordCommerce(event: CommerceAuditEvent): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        actorUserId: event.actorUserId ?? null,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        metadata: { actorKind: event.actorKind },
      },
    });
  }
  constructor(private readonly database: DatabaseUnitOfWork) {
    super();
  }
  async recordRequestDecision(event: RequestDecisionEvent): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        actorUserId: event.actorUserId,
        action:
          event.decision === "APPROVED" ? "INSTITUTION_REQUEST_APPROVED" : "INSTITUTION_REQUEST_REJECTED",
        entityType: "InstitutionRequest",
        entityId: event.requestId,
        metadata: { fromStatus: "PENDING_REVIEW", toStatus: event.decision },
      },
    });
  }
  async recordRequestNotice(event: {
    actorUserId?: string;
    requestId: string;
    action:
      | "REQUEST_REJECTION_NOTICE_SENT"
      | "REQUEST_REJECTION_NOTICE_FAILED"
      | "REQUEST_REJECTION_NOTICE_REQUEUED";
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        actorUserId: event.actorUserId ?? null,
        action: event.action,
        entityType: "InstitutionRequest",
        entityId: event.requestId,
        metadata: { actorKind: event.actorUserId ? "OPERATOR" : "SYSTEM" },
      },
    });
  }
  async recordEvaluationDraft(event: {
    tenantId: string;
    actorUserId: string;
    evaluationId: string;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorUserId: event.actorUserId,
        action: "EVALUATION_DRAFT_CREATED",
        entityType: "Evaluation",
        entityId: event.evaluationId,
      },
    });
  }
  async recordEvaluationRetry(event: {
    tenantId: string;
    actorUserId: string;
    evaluationId: string;
    attempt: number;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorUserId: event.actorUserId,
        action: "EVALUATION_RETRY_REQUESTED",
        entityType: "Evaluation",
        entityId: event.evaluationId,
        metadata: { attempt: event.attempt },
      },
    });
  }

  async recordEvaluationProcessed(event: {
    tenantId: string;
    actorUserId: string;
    evaluationId: string;
    status: string;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorUserId: event.actorUserId,
        action: "EVALUATION_PROCESSED",
        entityType: "Evaluation",
        entityId: event.evaluationId,
        metadata: { finalStatus: event.status },
      },
    });
  }

  async recordProductCatalogAction(event: {
    tenantId: string;
    actorUserId: string;
    productId: string;
    action: "PRODUCT_CREATED" | "PRODUCT_UPDATED" | "PRODUCT_ACTIVATED" | "PRODUCT_DEACTIVATED";
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.database.client.auditLog.create({
      data: {
        tenantId: event.tenantId,
        actorUserId: event.actorUserId,
        action: event.action,
        entityType: "FinancialProduct",
        entityId: event.productId,
        metadata: (event.metadata as Prisma.InputJsonValue) ?? undefined,
      },
    });
  }
}
