export interface RequestDecisionEvent {
  actorUserId: string;
  requestId: string;
  decision: "APPROVED" | "REJECTED";
}

export abstract class AuditWriter {
  abstract recordRequestDecision(event: RequestDecisionEvent): Promise<void>;
}
