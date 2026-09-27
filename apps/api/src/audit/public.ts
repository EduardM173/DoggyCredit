export interface RequestDecisionEvent {
  actorUserId: string;
  requestId: string;
  decision: "APPROVED" | "REJECTED";
}

export abstract class AuditWriter {
  abstract recordRequestDecision(event: RequestDecisionEvent): Promise<void>;
  abstract recordCommerce(event: CommerceAuditEvent): Promise<void>;
  abstract recordProvisioning(event: {
    tenantId: string;
    contractingId: string;
    membershipId: string;
    planId: string;
  }): Promise<void>;
}

export interface CommerceAuditEvent {
  action:
    | "CONTRACTING_ACCESS_ISSUED"
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
