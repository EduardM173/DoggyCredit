import { Injectable } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { ProvisioningPlans, ProvisioningEligibilityError } from "./provisioning-contract.js";

@Injectable()
export class ProvisioningPlansService extends ProvisioningPlans {
  constructor(private readonly db: DatabaseUnitOfWork) {
    super();
  }
  async eligibility(contractingId: string) {
    const c = await this.db.client.contracting.findUnique({
      where: { id: contractingId },
      include: {
        plan: { select: { id: true } },
        payments: { where: { status: "PAID" }, select: { amount: true, currency: true } },
      },
    });
    if (!c || c.status !== "CONFIRMED" || !c.confirmedAt)
      throw new ProvisioningEligibilityError("CONTRACT_NOT_CONFIRMED");
    if (
      !c.plan ||
      c.priceSnapshot.isNegative() ||
      (c.requiresPaymentSnapshot ? !c.priceSnapshot.greaterThan(0) : !c.priceSnapshot.isZero())
    )
      throw new ProvisioningEligibilityError("CONTRACT_TERMS_INVALID");
    if (
      c.requiresPaymentSnapshot &&
      !c.payments.some((p) => p.amount.equals(c.priceSnapshot) && p.currency === c.currencySnapshot)
    )
      throw new ProvisioningEligibilityError("PAID_PAYMENT_REQUIRED");
    return {
      contractingId: c.id,
      institutionRequestId: c.requestId,
      confirmedPlanId: c.confirmedPlanId,
      requiresPayment: c.requiresPaymentSnapshot,
    };
  }
  async ensureSubscription(contractingId: string, tenantId: string) {
    const c = await this.eligibility(contractingId);
    const existing = await this.db.client.tenantSubscription.findUnique({
      where: { sourceContractingId: contractingId },
    });
    if (existing) {
      if (
        existing.tenantId !== tenantId ||
        existing.planId !== c.confirmedPlanId ||
        existing.status !== "ACTIVE"
      )
        throw new ProvisioningEligibilityError("SUBSCRIPTION_CONFLICT");
      return existing.id;
    }
    if (
      await this.db.client.tenantSubscription.findFirst({
        where: { tenantId, status: "ACTIVE" },
        select: { id: true },
      })
    )
      throw new ProvisioningEligibilityError("ACTIVE_SUBSCRIPTION_CONFLICT");
    return (
      await this.db.client.tenantSubscription.create({
        data: { tenantId, planId: c.confirmedPlanId, sourceContractingId: contractingId, status: "ACTIVE" },
      })
    ).id;
  }
}
