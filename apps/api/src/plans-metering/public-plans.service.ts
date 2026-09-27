import { Injectable } from "@nestjs/common";
import { PrismaService } from "../infrastructure/prisma/prisma.service.js";

@Injectable()
export class PublicPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async isSelectable(code: string) {
    const plan = await this.prisma.plan.findFirst({
      where: {
        code,
        active: true,
        isPublic: true,
        price: { not: null },
        currency: "BOB",
        billingPeriod: "MONTHLY",
        requiresPayment: { not: null },
      },
      select: { price: true, requiresPayment: true },
    });
    return (
      !!plan?.price &&
      !plan.price.isNegative() &&
      (plan.requiresPayment ? plan.price.greaterThan(0) : plan.price.isZero())
    );
  }

  async list() {
    const plans = await this.prisma.plan.findMany({
      where: {
        active: true,
        isPublic: true,
        price: { not: null },
        currency: "BOB",
        billingPeriod: "MONTHLY",
        requiresPayment: { not: null },
      },
      select: {
        code: true,
        name: true,
        description: true,
        price: true,
        currency: true,
        billingPeriod: true,
        requiresPayment: true,
        features: true,
      },
      orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
    });
    return plans
      .filter(
        (plan) =>
          plan.price !== null &&
          !plan.price.isNegative() &&
          (plan.requiresPayment ? plan.price.greaterThan(0) : plan.price.isZero()),
      )
      .map((plan) => ({
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
