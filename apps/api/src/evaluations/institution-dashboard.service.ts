import { Injectable } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { TenantPreparationService, type TenantContext } from "../identity-tenants/public.js";
import type { EvaluationStatus } from "../generated/prisma/client.js";

export type DashboardPeriod = "today" | "last_7_days" | "last_30_days" | "month_to_date";

export interface PendingAttentionItem {
  id: string;
  status: EvaluationStatus;
  applicantName: string;
  applicantType: "PERSON" | "COMPANY";
  requestedAmount: number;
  updatedAt: string;
  reasonText: string;
  actionableType: "RETRY" | "REVIEW" | "MONITOR";
  actionUrl: string;
}

export interface DashboardMetricsDto {
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  role: "INSTITUTION_ADMIN" | "ANALYST" | string;
  period: {
    code: DashboardPeriod;
    label: string;
    from: string;
    to: string;
  };
  asOf: string;
  hasEvaluations: boolean;
  hasPeriodActivity: boolean;
  isSmallSample: boolean;
  attentionRequiredCount: number;
  pendingAttention: PendingAttentionItem[];
  metrics: {
    totalEvaluations: number;
    completionRate: number | null;
    byStatus: {
      COMPLETED: number;
      IN_PROGRESS: number;
      INCOMPLETE: number;
      FAILED: number;
      DRAFT: number;
    };
    byScope: {
      PERSON: number;
      COMPANY: number;
    };
    catalogCompatibility: {
      rate: number | null;
      compatibleCount: number;
      incompatibleCount: number;
    };
  };
  readiness: {
    ready: boolean;
    completedSteps: number;
    totalSteps: number;
    canEvaluate: boolean;
  };
  permissions: {
    canManageTeam: boolean;
    canManageProducts: boolean;
    canManageSources: boolean;
    canEvaluate: boolean;
  };
}

@Injectable()
export class InstitutionDashboardService {
  private readonly dashboardCache = new Map<string, { value: DashboardMetricsDto; expiresAt: number }>();

  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly preparation: TenantPreparationService,
  ) {}

  private resolvePeriodBounds(periodCode: DashboardPeriod = "last_30_days"): {
    from: Date;
    to: Date;
    label: string;
  } {
    const now = new Date();
    const to = now;

    switch (periodCode) {
      case "today": {
        // Start of today in America/La_Paz (UTC-4)
        const d = new Date(now.getTime() - 4 * 3600 * 1000);
        d.setUTCHours(0, 0, 0, 0);
        const from = new Date(d.getTime() + 4 * 3600 * 1000);
        return { from, to, label: "Hoy" };
      }
      case "last_7_days": {
        const from = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
        return { from, to, label: "Últimos 7 días" };
      }
      case "month_to_date": {
        const d = new Date(now.getTime() - 4 * 3600 * 1000);
        d.setUTCDate(1);
        d.setUTCHours(0, 0, 0, 0);
        const from = new Date(d.getTime() + 4 * 3600 * 1000);
        return { from, to, label: "Mes actual a la fecha" };
      }
      case "last_30_days":
      default: {
        const from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
        return { from, to, label: "Últimos 30 días" };
      }
    }
  }

  async getDashboard(ctx: TenantContext, periodCode: DashboardPeriod = "last_30_days"): Promise<DashboardMetricsDto> {
    const cacheKey = `${ctx.tenantId}:${periodCode}`;
    const nowTimestamp = Date.now();
    const cached = this.dashboardCache.get(cacheKey);
    if (cached && cached.expiresAt > nowTimestamp) {
      return cached.value;
    }

    const { from, to, label } = this.resolvePeriodBounds(periodCode);

    // 1. Check readiness & tenant information
    const prepStatus = await this.preparation.read(ctx);
    const tenantName = ctx.tenantName || prepStatus.tenant?.name || "Institución Financiera";
    const tenantSlug = ctx.tenantSlug || prepStatus.tenant?.slug || "";
    const isReady = typeof (prepStatus as { ready?: boolean }).ready === "boolean" ? Boolean((prepStatus as { ready?: boolean }).ready) : prepStatus.completed === 3;

    // 2. Count total lifetime evaluations (to distinguish brand new tenant vs no activity in period - CA-20.08)
    const totalLifetimeEvaluations = await this.db.client.evaluation.count({
      where: { tenantId: ctx.tenantId },
    });

    // 3. Query evaluations within selected period
    const evaluationsInPeriod = await this.db.client.evaluation.findMany({
      where: {
        tenantId: ctx.tenantId,
        createdAt: { gte: from, lte: to },
      },
      select: {
        id: true,
        status: true,
        requestedAmount: true,
        applicantSnapshot: true,
        createdAt: true,
        updatedAt: true,
        failureCode: true,
        failureMessage: true,
        recommendations: {
          select: {
            outcome: true,
            product: { select: { active: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // 4. Query pending items that require attention (FAILED, INCOMPLETE)
    const attentionEvaluations = await this.db.client.evaluation.findMany({
      where: {
        tenantId: ctx.tenantId,
        status: { in: ["FAILED", "INCOMPLETE"] },
      },
      select: {
        id: true,
        status: true,
        requestedAmount: true,
        applicantSnapshot: true,
        updatedAt: true,
        failureCode: true,
        failureMessage: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 5,
    });

    // 5. Aggregate metrics
    const totalEvaluations = evaluationsInPeriod.length;
    const byStatus = {
      COMPLETED: 0,
      IN_PROGRESS: 0,
      INCOMPLETE: 0,
      FAILED: 0,
      DRAFT: 0,
    };
    const byScope = {
      PERSON: 0,
      COMPANY: 0,
    };

    let compatibleCount = 0;
    let incompatibleCount = 0;

    for (const ev of evaluationsInPeriod) {
      if (ev.status in byStatus) {
        byStatus[ev.status as keyof typeof byStatus]++;
      }

      const snapshot = ev.applicantSnapshot as { type?: string } | null;
      if (snapshot?.type === "COMPANY") {
        byScope.COMPANY++;
      } else {
        byScope.PERSON++;
      }

      if (ev.status === "COMPLETED") {
        const hasRecommendedActiveProduct = ev.recommendations.some(
          (rec) => rec.outcome === "RECOMMENDED" && rec.product?.active !== false,
        );
        if (hasRecommendedActiveProduct) {
          compatibleCount++;
        } else {
          incompatibleCount++;
        }
      }
    }

    // Completion rate: COMPLETED / (COMPLETED + INCOMPLETE + FAILED)
    const closedCount = byStatus.COMPLETED + byStatus.INCOMPLETE + byStatus.FAILED;
    const completionRate =
      closedCount === 0 ? null : Math.round((byStatus.COMPLETED / closedCount) * 1000) / 10;

    // Catalog compatibility rate: compatibleCount / COMPLETED
    const catalogCompatibilityRate =
      byStatus.COMPLETED === 0 ? null : Math.round((compatibleCount / byStatus.COMPLETED) * 1000) / 10;

    // Format pending items without sensitive data (CA-20.10)
    const pendingAttention: PendingAttentionItem[] = attentionEvaluations.map((ev) => {
      const snap = ev.applicantSnapshot as { type?: string; name?: string } | null;
      const applicantName = snap?.name || "Solicitante registrado";
      const applicantType = snap?.type === "COMPANY" ? "COMPANY" : "PERSON";

      let reasonText = "Falla técnica en la consulta de fuentes. Disponible para reintento.";
      let actionableType: PendingAttentionItem["actionableType"] = "RETRY";

      if (ev.status === "INCOMPLETE") {
        reasonText = "Datos insuficientes o no disponibles en las fuentes consultadas.";
        actionableType = "REVIEW";
      }

      return {
        id: ev.id,
        status: ev.status,
        applicantName,
        applicantType,
        requestedAmount: Number(ev.requestedAmount),
        updatedAt: ev.updatedAt.toISOString(),
        reasonText,
        actionableType,
        actionUrl: `/${tenantSlug}/evaluaciones/${ev.id}`,
      };
    });

    const isSmallSample = totalEvaluations > 0 && totalEvaluations < 5;
    const isAdmin = ctx.role === "INSTITUTION_ADMIN";

    const result: DashboardMetricsDto = {
      tenant: {
        id: ctx.tenantId,
        name: tenantName,
        slug: tenantSlug,
      },
      role: ctx.role,
      period: {
        code: periodCode,
        label,
        from: from.toISOString(),
        to: to.toISOString(),
      },
      asOf: new Date().toISOString(),
      hasEvaluations: totalLifetimeEvaluations > 0,
      hasPeriodActivity: totalEvaluations > 0,
      isSmallSample,
      attentionRequiredCount: pendingAttention.length,
      pendingAttention,
      metrics: {
        totalEvaluations,
        completionRate,
        byStatus,
        byScope,
        catalogCompatibility: {
          rate: catalogCompatibilityRate,
          compatibleCount,
          incompatibleCount,
        },
      },
      readiness: {
        ready: isReady,
        completedSteps: prepStatus.completed,
        totalSteps: 3,
        canEvaluate: isReady,
      },
      permissions: {
        canManageTeam: isAdmin,
        canManageProducts: isAdmin,
        canManageSources: isAdmin,
        canEvaluate: isReady,
      },
    };

    this.dashboardCache.set(cacheKey, { value: result, expiresAt: nowTimestamp + 5000 });
    return result;
  }
}
