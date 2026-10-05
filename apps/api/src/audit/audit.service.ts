import { Injectable } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { AuditWriter, type RequestDecisionEvent, type CommerceAuditEvent } from "./public.js";

@Injectable()
export class AuditService extends AuditWriter {
  async recordInstitutionPreparation(event: {
    tenantId: string;
    actorUserId: string;
    action:
      | "INSTITUTION_INFORMATION_CONFIRMED"
      | "BANK_MOCK_ENABLED"
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
}
