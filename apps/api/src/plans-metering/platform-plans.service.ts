import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { AuditWriter } from "../audit/public.js";
import type { Plan } from "../generated/prisma/client.js";
import { isPublishable } from "./plan-terms.js";
import type {
  CreatePlanDto,
  PlanConfigurationDto,
  SetPlanStatusDto,
  UpdatePlanDto,
} from "./platform-plans.dto.js";

function configuration(body: PlanConfigurationDto) {
  const zero = /^0+(?:\.0{1,2})?$/.test(body.price);
  if (body.requiresPayment === zero)
    throw new BadRequestException("El importe y la opción de pago no son coherentes.");
  if (body.evaluationLimitMode === "LIMITADO" ? !body.evaluationsPerMonth : body.evaluationsPerMonth != null)
    throw new BadRequestException("El límite de evaluaciones no corresponde al modo seleccionado.");
  const features = body.features.map((feature) => feature.trim());
  if (features.some((feature) => !feature) || new Set(features).size !== features.length)
    throw new BadRequestException("Las características deben ser únicas y no estar vacías.");
  return {
    name: body.name.trim(),
    description: body.description?.trim() || null,
    price: body.price,
    currency: body.currency,
    billingPeriod: body.billingPeriod,
    requiresPayment: body.requiresPayment,
    evaluationLimitMode: body.evaluationLimitMode,
    evaluationsPerMonth: body.evaluationLimitMode === "LIMITADO" ? body.evaluationsPerMonth! : null,
    maxUsers: body.maxUsers ?? null,
    features,
  };
}

function auditState(plan: Plan) {
  return {
    code: plan.code,
    name: plan.name,
    description: plan.description,
    revision: plan.revision,
    effectiveFrom: plan.effectiveFrom.toISOString(),
    active: plan.active,
    isPublic: plan.isPublic,
    price: plan.price?.toFixed(2) ?? null,
    currency: plan.currency,
    billingPeriod: plan.billingPeriod,
    requiresPayment: plan.requiresPayment,
    evaluationLimitMode: plan.evaluationLimitMode,
    evaluationsPerMonth: plan.evaluationsPerMonth,
    maxUsers: plan.maxUsers,
    features: plan.features,
  };
}

@Injectable()
export class PlatformPlansService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly audit: AuditWriter,
  ) {}

  list() {
    return this.db.client.plan.findMany({ orderBy: [{ displayOrder: "asc" }, { code: "asc" }] });
  }

  async create(body: CreatePlanDto, actorUserId: string) {
    const data = configuration(body);
    try {
      return await this.db.run(async () => {
        const plan = await this.db.client.plan.create({
          data: { code: body.code, ...data, active: false, isPublic: false },
        });
        await this.audit.recordPlanCatalogAction({
          actorUserId,
          planId: plan.id,
          action: "PLAN_CREATED",
          before: null,
          after: auditState(plan),
          effectiveFrom: plan.effectiveFrom,
        });
        return plan;
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")
        throw new ConflictException("Ya existe un plan con ese código.");
      throw error;
    }
  }

  async update(id: string, body: UpdatePlanDto, actorUserId: string) {
    const data = configuration(body);
    return this.db.run(async () => {
      const previous = await this.requirePlan(id);
      if (previous.revision !== body.expectedRevision)
        throw new ConflictException("El plan cambió. Actualiza los datos y vuelve a intentarlo.");
      const same = Object.entries(data).every(([key, value]) =>
        key === "price"
          ? previous.price?.equals(value as string)
          : JSON.stringify(previous[key as keyof Plan]) === JSON.stringify(value),
      );
      if (same) return { plan: previous, changed: false };
      const result = await this.db.client.plan.updateMany({
        where: { id, revision: body.expectedRevision },
        data: { ...data, revision: { increment: 1 }, effectiveFrom: new Date() },
      });
      if (result.count !== 1)
        throw new ConflictException("El plan cambió. Actualiza los datos y vuelve a intentarlo.");
      const plan = await this.requirePlan(id);
      await this.audit.recordPlanCatalogAction({
        actorUserId,
        planId: id,
        action: "PLAN_UPDATED",
        before: auditState(previous),
        after: auditState(plan),
        effectiveFrom: plan.effectiveFrom,
      });
      return { plan, changed: true };
    });
  }

  async setStatus(id: string, body: SetPlanStatusDto, actorUserId: string) {
    return this.db.run(async () => {
      const previous = await this.requirePlan(id);
      if (previous.active === body.active && previous.isPublic === body.active)
        return { plan: previous, changed: false };
      if (previous.revision !== body.expectedRevision)
        throw new ConflictException("El plan cambió. Actualiza los datos y vuelve a intentarlo.");
      if (body.active && !isPublishable(previous))
        throw new BadRequestException("Completa las condiciones comerciales antes de activar el plan.");
      const result = await this.db.client.plan.updateMany({
        where: { id, revision: body.expectedRevision },
        data: {
          active: body.active,
          isPublic: body.active,
          revision: { increment: 1 },
          effectiveFrom: new Date(),
        },
      });
      if (result.count !== 1)
        throw new ConflictException("El plan cambió. Actualiza los datos y vuelve a intentarlo.");
      const plan = await this.requirePlan(id);
      await this.audit.recordPlanCatalogAction({
        actorUserId,
        planId: id,
        action: body.active ? "PLAN_ACTIVATED" : "PLAN_DEACTIVATED",
        before: auditState(previous),
        after: auditState(plan),
        effectiveFrom: plan.effectiveFrom,
      });
      return { plan, changed: true };
    });
  }

  private async requirePlan(id: string) {
    const plan = await this.db.client.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException("Plan no encontrado.");
    return plan;
  }
}
