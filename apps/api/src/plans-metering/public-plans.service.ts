import { Injectable } from "@nestjs/common";
import { PrismaService } from "../infrastructure/prisma/prisma.service.js";
import { isOfferEligible } from "./plan-terms.js";

@Injectable()
export class PublicPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async isSelectable(code: string) {
    const plan = await this.prisma.plan.findUnique({ where: { code } });
    return plan ? isOfferEligible(plan) : false;
  }

  async list() {
    const plans = await this.prisma.plan.findMany({
      where: { active: true, isPublic: true },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    });
    return plans.filter(isOfferEligible).map((plan) => ({
      code: plan.code,
      name: plan.name,
      shortDescription: plan.description,
      price: plan.price!.toFixed(2),
      currency: plan.currency!,
      billingPeriod: plan.billingPeriod!,
      requiresPayment: plan.requiresPayment!,
      highlights: plan.features,
    }));
  }
}
