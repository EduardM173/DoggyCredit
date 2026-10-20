import type { Plan } from "../generated/prisma/client.js";
import type { Prisma } from "../generated/prisma/client.js";

export type PlanTerms = {
  planId: string;
  revision: number;
  code: string;
  name: string;
  price: string;
  currency: string;
  billingPeriod: string;
  requiresPayment: boolean;
  features: string[];
  evaluationLimitMode: "NO_CONFIGURADO" | "LIMITADO" | "ILIMITADO";
  evaluationsPerMonth: number | null;
  maxUsers: number | null;
  scoringEnabled: boolean;
};

export function planTerms(plan: Plan): PlanTerms {
  if (plan.price === null || !plan.currency || !plan.billingPeriod || plan.requiresPayment === null)
    throw new Error("El plan no tiene condiciones comerciales completas.");
  return {
    planId: plan.id,
    revision: plan.revision,
    code: plan.code,
    name: plan.name,
    price: plan.price.toFixed(2),
    currency: plan.currency,
    billingPeriod: plan.billingPeriod,
    requiresPayment: plan.requiresPayment,
    features: plan.features,
    evaluationLimitMode: plan.evaluationLimitMode,
    evaluationsPerMonth: plan.evaluationsPerMonth,
    maxUsers: plan.maxUsers,
    scoringEnabled: plan.scoringEnabled,
  };
}

export function isOfferEligible(plan: Plan): boolean {
  return plan.active && plan.isPublic && isPublishable(plan);
}

export function contractedTerms(snapshot: Prisma.JsonValue | null, plan: Plan): PlanTerms {
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const terms = snapshot as Partial<PlanTerms>;
    if (
      typeof terms.planId === "string" &&
      typeof terms.price === "string" &&
      typeof terms.name === "string" &&
      typeof terms.evaluationLimitMode === "string"
    )
      return terms as PlanTerms;
  }
  return planTerms(plan);
}

export function isPublishable(plan: Plan): boolean {
  return Boolean(
    plan.name.trim() &&
    plan.price !== null &&
    !plan.price.isNegative() &&
    plan.currency === "BOB" &&
    plan.billingPeriod === "MONTHLY" &&
    plan.requiresPayment !== null &&
    (plan.requiresPayment ? plan.price.greaterThan(0) : plan.price.isZero()) &&
    !plan.scoringEnabled &&
    (plan.evaluationLimitMode !== "LIMITADO" ||
      (plan.evaluationsPerMonth !== null && plan.evaluationsPerMonth > 0)) &&
    (plan.evaluationLimitMode === "LIMITADO" || plan.evaluationsPerMonth === null) &&
    (plan.maxUsers === null || plan.maxUsers > 0),
  );
}
