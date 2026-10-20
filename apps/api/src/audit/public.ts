import type { AuditPageDto } from "./audit.dto.js";
import type { AuditQueryDto, PlatformAuditQueryDto } from "./audit-query.dto.js";

export * from "./audit.dto.js";
export * from "./audit-query.dto.js";

export interface RequestDecisionEvent {
  actorUserId: string;
  requestId: string;
  decision: "APPROVED" | "REJECTED";
}

export abstract class AuditWriter {
  abstract recordPlatformTeamEvent(event: {
    actorUserId?: string;
    action: string;
    entityType: "PlatformInvitation" | "User";
    entityId: string;
    metadata: Record<string, string>;
  }): Promise<void>;
  abstract countRecentPlatformInvitations(actorUserId: string, since: Date): Promise<number>;
  abstract recordTeamInvitation(event: {
    tenantId: string;
    actorUserId: string;
    invitationId: string;
    action:
      | "ANALYST_INVITATION_CREATED"
      | "ANALYST_INVITATION_RESENT"
      | "ADMIN_INVITATION_CREATED"
      | "ADMIN_INVITATION_RESENT";
  }): Promise<void>;
  abstract recordTeamAccess(event: {
    tenantId: string;
    actorUserId: string;
    membershipId: string;
    action: "INVITATION_CANCELLED" | "MEMBERSHIP_SUSPENDED" | "MEMBERSHIP_REACTIVATED" | "MEMBERSHIP_REVOKED";
    fromStatus: string;
    toStatus: string;
  }): Promise<void>;
  abstract recordInstitutionPreparation(event: {
    tenantId: string;
    actorUserId: string;
    action:
      | "INSTITUTION_INFORMATION_CONFIRMED"
      | "BANK_MOCK_ENABLED"
      | "BUREAU_MOCK_ENABLED"
      | "BUREAU_MOCK_DISABLED"
      | "INSTITUTION_PRODUCTS_CONFIRMED"
      | "INSTITUTION_PREPARED";
  }): Promise<void>;
  abstract recordMembershipActivation(event: {
    userId: string;
    tenantId: string;
    membershipId: string;
    invitationId: string;
  }): Promise<void>;
  abstract recordRequestDecision(event: RequestDecisionEvent): Promise<void>;
  abstract recordRequestNotice(event: {
    actorUserId?: string;
    requestId: string;
    action:
      | "REQUEST_REJECTION_NOTICE_SENT"
      | "REQUEST_REJECTION_NOTICE_FAILED"
      | "REQUEST_REJECTION_NOTICE_REQUEUED";
  }): Promise<void>;
  abstract recordCommerce(event: CommerceAuditEvent): Promise<void>;
  abstract recordProvisioning(event: {
    tenantId: string;
    contractingId: string;
    membershipId: string;
    planId: string;
  }): Promise<void>;
  abstract recordEvaluationDraft(event: {
    tenantId: string;
    actorUserId: string;
    evaluationId: string;
  }): Promise<void>;
  abstract recordEvaluationProcessed(event: {
    tenantId: string;
    actorUserId: string;
    evaluationId: string;
    status: string;
  }): Promise<void>;
  /** HU-30 (CA-30.07): cambios autorizados de la habilitación global de un proveedor. */
  abstract recordProviderAdministration(event: {
    actorUserId: string;
    providerId: string;
    providerCode: string;
    action: "PROVIDER_GLOBALLY_ENABLED" | "PROVIDER_GLOBALLY_DISABLED";
    previousEnabled: boolean;
    currentEnabled: boolean;
    reason?: string;
  }): Promise<void>;
  /** HU-23: transición de salud de un proveedor (una vez por episodio, sin PII). */
  abstract recordProviderHealthTransition(event: {
    providerId: string;
    providerCode: string;
    action: "PROVIDER_DEGRADED" | "PROVIDER_RECOVERED";
    from: string;
    to: string;
    episodeId: string;
  }): Promise<void>;
  abstract findOpenProviderEpisode(
    providerId: string,
  ): Promise<{ episodeId: string; startedAt: Date } | null>;
  abstract recordProductCatalogAction(event: {
    tenantId: string;
    actorUserId: string;
    productId: string;
    action: "PRODUCT_CREATED" | "PRODUCT_UPDATED" | "PRODUCT_ACTIVATED" | "PRODUCT_DEACTIVATED";
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export abstract class AuditReader {
  abstract queryInstitutionAudit(
    tenantId: string,
    query: AuditQueryDto,
    tenantSlug?: string,
  ): Promise<AuditPageDto>;

  abstract queryPlatformAudit(query: PlatformAuditQueryDto): Promise<AuditPageDto>;
}

export interface CommerceAuditEvent {
  action:
    | "CONTRACTING_ACCESS_ISSUED"
    | "CONTRACTING_ACCESS_QUEUED"
    | "CONTRACTING_ACCESS_REQUEUED"
    | "PROVISIONING_RETRY_REQUESTED"
    | "INITIAL_INVITATION_RESENT"
    | "CONTRACTING_PLAN_CONFIRMED"
    | "PAYMENT_CREATED"
    | "PAYMENT_PAID"
    | "PAYMENT_FAILED"
    | "PAYMENT_CANCELLED"
    | "CONTRACTING_CONFIRMED";
  entityType: "InstitutionRequest" | "Contracting" | "Payment";
  entityId: string;
  actorUserId?: string;
  actorKind: "OPERATOR" | "REPRESENTATIVE" | "PAYMENT_PROVIDER";
}
