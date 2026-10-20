/* eslint-disable no-restricted-imports -- direct import to avoid circular dependency in financial-integrations */
import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { contractedTerms, getCycleBounds, type CapacityState } from "../../plans-metering/public.js";
import {
  ProviderHealthReadService,
  type IntegrationHealthSummary,
  type MonitoredState,
} from "../../financial-integrations/health/provider-health-read.service.js";

export interface TenantOperationalDetailDto {
  institution: {
    tenantId: string;
    institutionName: string;
    slug: string;
    taxId: string;
    institutionType: string;
    status: string;
    approvedAt: string | null;
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
    price: number;
    currency: string;
    billingPeriod: string;
    evaluationsLimit: number | null;
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
    renewalDate: string;
    timezone: "America/La_Paz";
  };
  membershipsSummary: {
    totalUsers: number;
    adminsCount: number;
    analystsCount: number;
    members: Array<{
      id: string;
      fullName: string;
      email: string;
      role: "INSTITUTION_ADMIN" | "ANALYST";
      status: "INVITED" | "ACTIVE" | "SUSPENDED";
      isInitialAdmin: boolean;
      createdAt: string;
    }>;
  };
  integrations: Array<{
    providerCode: string;
    providerName: string;
    enabled: boolean;
    globallyEnabled: boolean;
    healthState: MonitoredState;
    healthLabel: string;
    lastSignalAt: string | null;
    hasIssue: boolean;
  }>;
  privacyNotice: string;
}

@Injectable()
export class InstitutionsService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly providerHealth: ProviderHealthReadService,
  ) {}

  async list(query: {
    search?: string;
    activationStatus?: "INVITED" | "ACTIVE" | "SUSPENDED";
    plan?: string;
    page: number;
    pageSize: number;
  }) {
    const search = query.search?.trim();
    const taxSearch = search?.replace(/[\s.-]/g, "");
    const where: Prisma.TenantWhereInput = {
      createdFromRequestId: { not: null },
      ...(query.activationStatus
        ? {
            memberships: {
              some: {
                isInitialAdmin: true,
                role: "INSTITUTION_ADMIN",
                status: query.activationStatus,
              },
            },
          }
        : {
            memberships: {
              some: {
                isInitialAdmin: true,
                role: "INSTITUTION_ADMIN",
              },
            },
          }),
      ...(query.plan
        ? {
            subscriptions: {
              some: {
                status: "ACTIVE",
                plan: { code: query.plan },
              },
            },
          }
        : {}),
      ...(search
        ? {
            OR: [
              { legalName: { contains: search, mode: "insensitive" } },
              { taxId: { contains: taxSearch || search, mode: "insensitive" } },
              {
                memberships: {
                  some: {
                    isInitialAdmin: true,
                    role: "INSTITUTION_ADMIN",
                    user: {
                      OR: [
                        { fullName: { contains: search, mode: "insensitive" } },
                        { email: { contains: search, mode: "insensitive" } },
                      ],
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };

    const total = await this.db.client.tenant.count({ where });
    const rows = await this.db.client.tenant.findMany({
      where,
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      orderBy: [{ createdFromRequest: { reviewedAt: { sort: "desc", nulls: "last" } } }, { id: "desc" }],
      select: {
        id: true,
        slug: true,
        legalName: true,
        taxId: true,
        institutionType: true,
        createdFromRequest: { select: { reviewedAt: true } },
        memberships: {
          where: { isInitialAdmin: true, role: "INSTITUTION_ADMIN" },
          select: { status: true, user: { select: { fullName: true, email: true } } },
          take: 1,
        },
        _count: {
          select: { memberships: true },
        },
        subscriptions: {
          where: { status: "ACTIVE" },
          include: { plan: true },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        integrations: {
          where: { enabled: true },
          select: {
            provider: { select: { code: true } },
          },
        },
      },
    });

    const tenantIds = rows.map((r) => r.id);
    const { start, end } = getCycleBounds();

    const usageCounts =
      tenantIds.length > 0
        ? await this.db.client.usageRecord.groupBy({
            by: ["tenantId"],
            where: {
              tenantId: { in: tenantIds },
              metric: "EVALUATION",
              occurredAt: { gte: start, lt: end },
            },
            _count: { _all: true },
          })
        : [];
    const usageMap = new Map<string, number>(usageCounts.map((u) => [u.tenantId, u._count._all]));

    const providerHealthList: IntegrationHealthSummary[] = await this.providerHealth.list().catch(() => []);
    const providerHealthMap = new Map<string, IntegrationHealthSummary>(
      providerHealthList.map((p) => [p.code, p]),
    );

    const items = rows.map((row) => {
      const activeSub = row.subscriptions[0] ?? null;
      let plan: { code: string; name: string } | null = null;
      let capacityState: CapacityState = "NO_CONFIGURADO";
      let limit: number | null = null;

      if (activeSub) {
        const terms = contractedTerms(activeSub.termsSnapshot, activeSub.plan);
        plan = {
          code: terms.code,
          name: terms.name,
        };
        capacityState = terms.evaluationLimitMode;
        limit = capacityState === "LIMITADO" ? terms.evaluationsPerMonth : null;
      }

      const consumed = usageMap.get(row.id) ?? 0;
      const percentage =
        limit !== null && limit > 0 ? Math.min(100, Math.round((consumed / limit) * 100)) : null;

      const enabledCodes = row.integrations.map((i) => i.provider.code);
      let integrationsHealthState: MonitoredState | "NO_CONFIGURADO" = "NO_CONFIGURADO";
      let integrationsHealthLabel = "Sin fuentes habilitadas";
      let hasDegraded = false;
      let degradedProviderCode: string | undefined;

      if (enabledCodes.length > 0) {
        const degradedProvider = enabledCodes.find(
          (c) => providerHealthMap.get(c)?.health.state === "DEGRADADO_OBSERVADO",
        );
        if (degradedProvider) {
          integrationsHealthState = "DEGRADADO_OBSERVADO";
          integrationsHealthLabel = "Degradado (observado)";
          hasDegraded = true;
          degradedProviderCode = degradedProvider;
        } else if (enabledCodes.some((c) => providerHealthMap.get(c)?.health.state === "ERROR_MONITOREO")) {
          integrationsHealthState = "ERROR_MONITOREO";
          integrationsHealthLabel = "Error de monitoreo";
        } else if (
          enabledCodes.some((c) => providerHealthMap.get(c)?.health.state === "SIN_SENAL_RECIENTE")
        ) {
          integrationsHealthState = "SIN_SENAL_RECIENTE";
          integrationsHealthLabel = "Sin señal reciente";
        } else {
          integrationsHealthState = "OPERATIVO_OBSERVADO";
          integrationsHealthLabel = "Operativo (observado)";
        }
      }

      return {
        tenantId: row.id,
        institutionName: row.legalName,
        slug: row.slug,
        nit: row.taxId,
        initialAdmin: {
          name: row.memberships[0]?.user.fullName ?? "No asignado",
          email: row.memberships[0]?.user.email ?? "No asignado",
        },
        activationStatus: row.memberships[0]?.status ?? "INVITED",
        approvedAt: row.createdFromRequest?.reviewedAt?.toISOString() ?? null,
        plan,
        capacity: {
          state: capacityState,
          consumed,
          limit,
          percentage,
        },
        membersCount: row._count.memberships,
        integrationsHealth: {
          state: integrationsHealthState,
          label: integrationsHealthLabel,
          hasDegraded,
          degradedProviderCode,
        },
      };
    });

    return {
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async getDetail(tenantId: string): Promise<TenantOperationalDetailDto> {
    const tenant = await this.db.client.tenant.findUnique({
      where: { id: tenantId },
      include: {
        createdFromRequest: { select: { reviewedAt: true } },
        memberships: {
          include: {
            user: { select: { fullName: true, email: true } },
          },
          orderBy: [{ isInitialAdmin: "desc" }, { createdAt: "asc" }],
        },
        subscriptions: {
          include: { plan: true },
          orderBy: { createdAt: "desc" },
        },
        integrations: {
          include: { provider: true },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException("Institución no encontrada.");
    }

    const { start, end } = getCycleBounds();
    const activeSub = tenant.subscriptions.find((s) => s.status === "ACTIVE") ?? null;

    let capacityState: CapacityState;
    let planData: TenantOperationalDetailDto["plan"] = null;
    let limit: number | null = null;
    let consumed = 0;

    if (activeSub) {
      const p = activeSub.plan;
      const terms = contractedTerms(activeSub.termsSnapshot, p);
      planData = {
        id: p.id,
        code: terms.code,
        name: terms.name,
        price: Number(terms.price),
        currency: terms.currency,
        billingPeriod: terms.billingPeriod,
        evaluationsLimit: terms.evaluationLimitMode === "LIMITADO" ? terms.evaluationsPerMonth : null,
        maxUsers: terms.maxUsers,
      };

      capacityState = terms.evaluationLimitMode;
      limit = capacityState === "LIMITADO" ? terms.evaluationsPerMonth : null;

      consumed = await this.db.client.usageRecord.count({
        where: {
          tenantId,
          metric: "EVALUATION",
          occurredAt: { gte: start, lt: end },
        },
      });
    } else {
      const anySub = tenant.subscriptions[0] ?? null;
      if (anySub) {
        capacityState = "NO_DISPONIBLE";
      } else {
        capacityState = "NO_CONFIGURADO";
      }
    }

    const remaining = limit !== null ? Math.max(0, limit - consumed) : null;
    const percentage =
      limit !== null && limit > 0 ? Math.min(100, Math.round((consumed / limit) * 100)) : null;
    const isExceeded = limit !== null && consumed >= limit;

    const providerHealthList: IntegrationHealthSummary[] = await this.providerHealth.list().catch(() => []);
    const healthMap = new Map<string, IntegrationHealthSummary>(providerHealthList.map((h) => [h.code, h]));

    const integrations = tenant.integrations.map((ti) => {
      const ph = healthMap.get(ti.provider.code);
      const state: MonitoredState = ph?.health.state ?? "SIN_SENAL_RECIENTE";
      return {
        providerCode: ti.provider.code,
        providerName: ti.provider.name,
        enabled: ti.enabled,
        globallyEnabled: ti.provider.globallyEnabled,
        healthState: state,
        healthLabel:
          state === "OPERATIVO_OBSERVADO"
            ? "Operativo (observado)"
            : state === "DEGRADADO_OBSERVADO"
              ? "Degradado (observado)"
              : state === "SIN_SENAL_RECIENTE"
                ? "Sin señal reciente"
                : "Error de monitoreo",
        lastSignalAt: ph?.health.lastSignalAt ?? null,
        hasIssue: ti.enabled && state === "DEGRADADO_OBSERVADO",
      };
    });

    const members = tenant.memberships.map((m) => ({
      id: m.id,
      fullName: m.user.fullName,
      email: m.user.email,
      role: m.role as "INSTITUTION_ADMIN" | "ANALYST",
      status: m.status as "INVITED" | "ACTIVE" | "SUSPENDED",
      isInitialAdmin: m.isInitialAdmin,
      createdAt: m.createdAt.toISOString(),
    }));

    return {
      institution: {
        tenantId: tenant.id,
        institutionName: tenant.legalName,
        slug: tenant.slug,
        taxId: tenant.taxId,
        institutionType: tenant.institutionType,
        status: tenant.status,
        approvedAt: tenant.createdFromRequest?.reviewedAt?.toISOString() ?? null,
      },
      subscription: {
        id: activeSub?.id ?? tenant.subscriptions[0]?.id ?? null,
        status: activeSub
          ? "ACTIVE"
          : tenant.subscriptions[0]
            ? (tenant.subscriptions[0].status as "SUSPENDED" | "ENDED")
            : "NO_SUBSCRIPTION",
        startsAt:
          activeSub?.startsAt.toISOString() ?? tenant.subscriptions[0]?.startsAt.toISOString() ?? null,
        endsAt: activeSub?.endsAt
          ? activeSub.endsAt.toISOString()
          : tenant.subscriptions[0]?.endsAt
            ? tenant.subscriptions[0].endsAt.toISOString()
            : null,
      },
      plan: planData,
      capacity: {
        state: capacityState,
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
        renewalDate: end.toISOString(),
        timezone: "America/La_Paz",
      },
      membershipsSummary: {
        totalUsers: members.length,
        adminsCount: members.filter((m) => m.role === "INSTITUTION_ADMIN").length,
        analystsCount: members.filter((m) => m.role === "ANALYST").length,
        members,
      },
      integrations,
      privacyNotice:
        "Acceso operativo restringido. Conforme a las políticas de secreto bancario y privacidad (RF-05, CA-22.05), la información de solicitantes, expedientes, créditos y consultas individuales permanece inaccesible.",
    };
  }
}
