export class ProvisioningEligibilityError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
export interface ProvisioningEligibility {
  contractingId: string;
  institutionRequestId: string;
  confirmedPlanId: string;
  requiresPayment: boolean;
}
export abstract class ProvisioningPlans {
  abstract eligibility(contractingId: string): Promise<ProvisioningEligibility>;
  abstract ensureSubscription(contractingId: string, tenantId: string): Promise<string>;
}
