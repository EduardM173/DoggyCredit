import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";

export type CapacityState = "LIMITADO" | "ILIMITADO" | "NO_CONFIGURADO" | "NO_DISPONIBLE";

export interface TenantPlanMeteringDto {
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  subscription: {
    id: string | null;
    status: "ACTIVE" | "SUSPENDED" | "ENDED" | "NO_SUBSCRIPTION";
    startsAt: string | null;
    endsAt: string | null;
  };
  plan: {
    id: string | null;
    code: string;
    name: string;
    description: string | null;
    price: number;
    currency: string;
    billingPeriod: string;
    requiresPayment: boolean;
    features: string[];
    maxUsers: number | null;
  } | null;
  capacity: {
    state: CapacityState;
    unit: string;
    limit: number | null;
    consumed: number;
    remaining: number | null;
    percentage: number | null;
    isExceeded: boolean;
  };
  cycle: {
    startDate: string;
    endDate: string;
    timezone: "America/La_Paz";
    renewalDate: string;
  };
  scoring: {
    enabled: boolean;
    type: "RULES_BASED";
    description: string;
  };
  asOf: string;
  permissions: {
    canViewCommercialTerms: boolean;
    canEvaluate: boolean;
    role: string;
  };
  environment: {
    isSimulation: boolean;
    disclaimer: string;
  };
}

export function getCycleBounds(referenceDate = new Date()): { start: Date; end: Date } {
  // Offset by -4 hours to resolve UTC-4 (America/La_Paz) calendar month
  const laPazTime = new Date(referenceDate.getTime() - 4 * 3600 * 1000);
  const year = laPazTime.getUTCFullYear();
  const month = laPazTime.getUTCMonth(); // 0-indexed

  // 1st of month at 00:00:00 in America/La_Paz is 04:00:00 UTC
  const start = new Date(Date.UTC(year, month, 1, 4, 0, 0, 0));
  // 1st of next month at 00:00:00 in America/La_Paz is 04:00:00 UTC
  const end = new Date(Date.UTC(year, month + 1, 1, 4, 0, 0, 0));

  return { start, end };
}

@Injectable()
export class TenantPlanMeteringService {
  constructor(private readonly db: DatabaseUnitOfWork) {}

  async getTenantPlanAndUsage(
    tenantId: string,
    role: string,
    referenceDate = new Date(),
  ): Promise<TenantPlanMeteringDto> {
    const tenant = await this.db.client.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, legalName: true, slug: true },
    });
    if (!tenant) {
      throw new NotFoundException("Institución no encontrada.");
    }

    const { start, end } = getCycleBounds(referenceDate);

    // Fetch active subscription
    const activeSub = await this.db.client.tenantSubscription.findFirst({
      where: { tenantId, status: "ACTIVE" },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    });

    let state: CapacityState;
    let subStatus: "ACTIVE" | "SUSPENDED" | "ENDED" | "NO_SUBSCRIPTION" = "NO_SUBSCRIPTION";
    let startsAt: string | null = null;
    let endsAt: string | null = null;
    let subId: string | null = null;

    let planData: TenantPlanMeteringDto["plan"] = null;
    let limit: number | null = null;
    let consumed = 0;
    let isExceeded = false;

    if (activeSub) {
      subStatus = "ACTIVE";
      subId = activeSub.id;
      startsAt = activeSub.startsAt.toISOString();
      endsAt = activeSub.endsAt ? activeSub.endsAt.toISOString() : null;

      const p = activeSub.plan;
      planData = {
        id: p.id,
        code: p.code,
        name: p.name,
        description: p.description,
        price: p.price ? Number(p.price) : 0,
        currency: p.currency ?? "BOB",
        billingPeriod: p.billingPeriod ?? "MONTHLY",
        requiresPayment: Boolean(p.requiresPayment),
        features: p.features,
        maxUsers: p.maxUsers,
      };

      if (p.evaluationsPerMonth === null) {
        state = "ILIMITADO";
        limit = null;
      } else {
        state = "LIMITADO";
        limit = p.evaluationsPerMonth;
      }

      // Count UsageRecord in cycle
      consumed = await this.db.client.usageRecord.count({
        where: {
          tenantId,
          metric: "EVALUATION",
          occurredAt: {
            gte: start,
            lt: end,
          },
        },
      });

      if (state === "LIMITADO" && limit !== null) {
        isExceeded = consumed >= limit;
      }
    } else {
      // Check for inactive subscriptions (SUSPENDED / ENDED)
      const anySub = await this.db.client.tenantSubscription.findFirst({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
      });
      if (anySub) {
        state = "NO_DISPONIBLE";
        subStatus = anySub.status as "SUSPENDED" | "ENDED";
        startsAt = anySub.startsAt.toISOString();
        endsAt = anySub.endsAt ? anySub.endsAt.toISOString() : null;
      } else {
        state = "NO_CONFIGURADO";
      }
    }

    const remaining = limit !== null ? Math.max(0, limit - consumed) : null;
    const percentage =
      limit !== null && limit > 0
        ? Math.min(100, Math.round((consumed / limit) * 100))
        : null;

    const isAdmin = role === "INSTITUTION_ADMIN";
    const canEvaluate = state !== "NO_CONFIGURADO" && state !== "NO_DISPONIBLE" && !isExceeded;

    return {
      tenant: {
        id: tenant.id,
        name: tenant.legalName,
        slug: tenant.slug,
      },
      subscription: {
        id: subId,
        status: subStatus,
        startsAt,
        endsAt,
      },
      plan: planData,
      capacity: {
        state,
        unit: "evaluaciones",
        limit,
        consumed,
        remaining,
        percentage,
        isExceeded,
      },
      cycle: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        timezone: "America/La_Paz",
        renewalDate: end.toISOString(),
      },
      scoring: {
        enabled: true,
        type: "RULES_BASED",
        description:
          "Evaluación de idoneidad y capacidad de pago basada en reglas financieras y catálogo institucional (no scoring predictivo).",
      },
      asOf: new Date().toISOString(),
      permissions: {
        canViewCommercialTerms: isAdmin,
        canEvaluate,
        role,
      },
      environment: {
        isSimulation: true,
        disclaimer:
          "DoggyCredit opera en un entorno simulado de pagos (DoggyPay). No se efectúan cobros reales ni existen recargos ocultos por uso de plataforma.",
      },
    };
  }

  async checkQuotaAvailable(tenantId: string, role: string, referenceDate = new Date()): Promise<void> {
    const { start, end } = getCycleBounds(referenceDate);

    const activeSub = await this.db.client.tenantSubscription.findFirst({
      where: { tenantId, status: "ACTIVE" },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    });

    if (!activeSub) {
      throw new ForbiddenException({
        statusCode: 403,
        code: "SUBSCRIPTION_NOT_ACTIVE",
        message: "La suscripción institucional no se encuentra activa o configurada para procesar evaluaciones.",
      });
    }

    const limit = activeSub.plan.evaluationsPerMonth;
    if (limit === null) {
      // Unlimited evaluations
      return;
    }

    const consumed = await this.db.client.usageRecord.count({
      where: {
        tenantId,
        metric: "EVALUATION",
        occurredAt: {
          gte: start,
          lt: end,
        },
      },
    });

    if (consumed >= limit) {
      const isAnalyst = role === "ANALYST";
      const message = isAnalyst
        ? `Límite mensual del plan alcanzado (${consumed}/${limit} evaluaciones). Contacta a tu administrador para solicitar una ampliación de capacidad.`
        : `La institución ha alcanzado el límite mensual de ${limit} evaluaciones contratadas en su plan. Comuníquese para solicitar una ampliación.`;

      throw new ForbiddenException({
        statusCode: 403,
        code: "PLAN_QUOTA_EXCEEDED",
        message,
        consumed,
        limit,
        renewsAt: end.toISOString(),
      });
    }
  }

  async recordEvaluationUsage(tenantId: string, evaluationId: string): Promise<boolean> {
    const idempotencyKey = `usage_eval_${evaluationId}`;
    try {
      await this.db.client.usageRecord.create({
        data: {
          tenantId,
          metric: "EVALUATION",
          quantity: 1,
          referenceType: "Evaluation",
          referenceId: evaluationId,
          idempotencyKey,
        },
      });
      return true;
    } catch (err: unknown) {
      // Prisma unique constraint violation code is P2002
      const isUniqueViolation =
        (typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "P2002") ||
        (err instanceof Error && err.message.includes("Unique constraint"));

      if (isUniqueViolation) {
        return false; // Idempotently absorbed
      }
      throw err;
    }
  }
}
