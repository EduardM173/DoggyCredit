import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import { BankMockSource, BureauMockSource } from "../../financial-integrations/public.js";
import { PreparationProducts } from "../../recommendations/public.js";
import { AuditWriter } from "../../audit/public.js";
import type { InstitutionType } from "../../generated/prisma/client.js";
import type { TenantContext } from "./tenant-context.guard.js";

export interface SourceItemDto {
  code: string;
  name: string;
  kind: string;
  description: string;
  purpose: string;
  coverage: string;
  available: boolean;
  enabled: boolean;
  healthStatus: "ACTIVE" | "DEGRADED" | "INACTIVE";
  /** HU-30: false cuando la plataforma deshabilitó el proveedor; distinto de `enabled` (decisión de la institución). */
  globallyEnabled: boolean;
}

@Injectable()
export class TenantPreparationService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly bank: BankMockSource,
    private readonly bureau: BureauMockSource,
    private readonly products: PreparationProducts,
    private readonly audit: AuditWriter,
  ) {}

  async read(ctx: TenantContext) {
    const [tenant, bankStatus, bureauStatus, products] = await Promise.all([
      this.db.client.tenant.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: {
          slug: true,
          legalName: true,
          taxId: true,
          institutionType: true,
          informationConfirmedAt: true,
          productsConfirmedAt: true,
        },
      }),
      this.bank.status(ctx.tenantId),
      this.bureau.status(ctx.tenantId),
      this.products.list(ctx.tenantId),
    ]);
    const steps = {
      institution: Boolean(tenant.informationConfirmedAt),
      source: bankStatus.enabled,
      products: Boolean(
        (tenant.productsConfirmedAt || products.some((product) => product.selected)) &&
        products.some((product) => product.selected && product.applicantScope !== "COMPANY"),
      ),
    };
    const completed = Object.values(steps).filter(Boolean).length;
    const sources: SourceItemDto[] = [
      {
        code: "BANK_MOCK",
        name: "Fuente bancaria simulada",
        kind: "BANK",
        description:
          "Proporciona información de cuentas, balances, ingresos, egresos y créditos bancarios simulados.",
        purpose: "Evaluación de capacidad de pago y flujo de ingresos mediante datos bancarios.",
        coverage: "Personas y microempresas con cuentas bancarias registradas.",
        available: bankStatus.available,
        enabled: bankStatus.enabled,
        healthStatus: bankStatus.healthStatus ?? (bankStatus.available ? "ACTIVE" : "INACTIVE"),
        globallyEnabled: bankStatus.globallyEnabled !== false,
      },
      {
        code: "BUREAU_MOCK",
        name: "Buró crediticio simulado",
        kind: "CREDIT_BUREAU",
        description:
          "Aporta historial crediticio consolidado, deuda global en el sistema financiero y comportamiento de mora histórico.",
        purpose:
          "Evaluación de antecedentes crediticios, riesgo de sobreendeudamiento y morosidad histórica.",
        coverage: "Cobertura orientada a solicitantes particulares y personas naturales.",
        available: bureauStatus.available,
        enabled: bureauStatus.enabled,
        healthStatus: bureauStatus.healthStatus ?? (bureauStatus.available ? "ACTIVE" : "INACTIVE"),
        globallyEnabled: bureauStatus.globallyEnabled !== false,
      },
    ];
    return {
      tenant: {
        name: tenant.legalName,
        slug: tenant.slug,
        taxId: tenant.taxId,
        type: tenant.institutionType,
      },
      user: { name: ctx.userName },
      membership: { role: ctx.role, status: "ACTIVE" as const },
      source: bankStatus,
      sources,
      products,
      steps,
      completed,
      percentage: Math.round((completed / 3) * 100),
      ready: completed === 3,
    };
  }

  private admin(ctx: TenantContext) {
    if (ctx.role !== "INSTITUTION_ADMIN")
      throw new ForbiddenException("Solo un administrador institucional puede preparar la institución.");
  }

  private async lockTenant(tenantId: string) {
    await this.db.client.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR UPDATE`;
  }

  private async recordReady(ctx: TenantContext, wasReady: boolean) {
    if (!wasReady && (await this.read(ctx)).ready)
      await this.audit.recordInstitutionPreparation({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        action: "INSTITUTION_PREPARED",
      });
  }

  async confirmInstitution(ctx: TenantContext, name: string, type: InstitutionType) {
    this.admin(ctx);
    const normalized = name.trim().replace(/\s+/g, " ");
    if (!normalized || normalized.length > 180) throw new BadRequestException("Introduce un nombre válido.");
    return this.db.run(async () => {
      await this.lockTenant(ctx.tenantId);
      const before = await this.read(ctx);
      const changed =
        !before.steps.institution || before.tenant.name !== normalized || before.tenant.type !== type;
      if (changed) {
        await this.db.client.tenant.update({
          where: { id: ctx.tenantId },
          data: {
            legalName: normalized,
            institutionType: type,
            informationConfirmedAt: new Date(),
          },
        });
        await this.audit.recordInstitutionPreparation({
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          action: "INSTITUTION_INFORMATION_CONFIRMED",
        });
        await this.recordReady(ctx, before.ready);
      }
      return this.read(ctx);
    });
  }

  async enableBank(ctx: TenantContext) {
    this.admin(ctx);
    return this.db.run(async () => {
      await this.lockTenant(ctx.tenantId);
      const before = await this.read(ctx);
      if (await this.bank.enable(ctx.tenantId)) {
        await this.audit.recordInstitutionPreparation({
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          action: "BANK_MOCK_ENABLED",
        });
        await this.recordReady(ctx, before.ready);
      }
      return this.read(ctx);
    });
  }

  async enableBureau(ctx: TenantContext, enabled = true) {
    this.admin(ctx);
    return this.db.run(async () => {
      await this.lockTenant(ctx.tenantId);
      const before = await this.read(ctx);
      if (await this.bureau.enable(ctx.tenantId, enabled)) {
        await this.audit.recordInstitutionPreparation({
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          action: enabled ? "BUREAU_MOCK_ENABLED" : "BUREAU_MOCK_DISABLED",
        });
        await this.recordReady(ctx, before.ready);
      }
      return this.read(ctx);
    });
  }

  async confirmProducts(ctx: TenantContext, ids: string[]) {
    this.admin(ctx);
    return this.db.run(async () => {
      await this.lockTenant(ctx.tenantId);
      const before = await this.read(ctx);
      const changed = await this.products.select(ctx.tenantId, ids);
      if (changed || !before.steps.products) {
        await this.db.client.tenant.update({
          where: { id: ctx.tenantId },
          data: { productsConfirmedAt: new Date() },
        });
        await this.audit.recordInstitutionPreparation({
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          action: "INSTITUTION_PRODUCTS_CONFIRMED",
        });
        await this.recordReady(ctx, before.ready);
      }
      return this.read(ctx);
    });
  }
}
