import { Injectable } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { AuditWriter, type RequestDecisionEvent, type CommerceAuditEvent } from "./public.js";

@Injectable()
export class AuditService extends AuditWriter {
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
