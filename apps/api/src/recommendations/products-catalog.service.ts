import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { AuditWriter } from "../audit/public.js";
import type { TenantContext } from "../identity-tenants/public.js";
import type {
  CreateProductDto,
  DeactivationImpactDto,
  ProductCatalogItemDto,
  UpdateProductDto,
} from "./products-catalog.dto.js";
import type { ApplicantScope, CreditPurpose, ProductCategory } from "../generated/prisma/enums.js";

@Injectable()
export class ProductsCatalogService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly audit: AuditWriter,
  ) {}

  private checkAdmin(ctx: TenantContext) {
    if (ctx.role !== "INSTITUTION_ADMIN") {
      throw new ForbiddenException(
        "Solo un administrador institucional puede crear o modificar productos crediticios.",
      );
    }
  }

  async list(ctx: TenantContext): Promise<ProductCatalogItemDto[]> {
    const products = await this.db.client.financialProduct.findMany({
      where: { tenantId: ctx.tenantId },
      include: {
        purposes: {
          select: { purpose: true },
        },
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });

    return products.map((p) => this.serialize(p));
  }

  async getById(ctx: TenantContext, productId: string): Promise<ProductCatalogItemDto> {
    const product = await this.db.client.financialProduct.findFirst({
      where: { id: productId, tenantId: ctx.tenantId },
      include: {
        purposes: {
          select: { purpose: true },
        },
      },
    });

    if (!product) {
      throw new NotFoundException("Producto crediticio no encontrado.");
    }

    return this.serialize(product);
  }

  async create(ctx: TenantContext, dto: CreateProductDto): Promise<ProductCatalogItemDto> {
    this.checkAdmin(ctx);

    const trimmedName = dto.name?.trim();
    if (!trimmedName || trimmedName.length > 160) {
      throw new BadRequestException(
        "El nombre del producto es obligatorio y no puede superar los 160 caracteres.",
      );
    }

    // Uniqueness within tenant (case-insensitive)
    const existing = await this.db.client.financialProduct.findFirst({
      where: {
        tenantId: ctx.tenantId,
        name: { equals: trimmedName, mode: "insensitive" },
      },
    });
    if (existing) {
      throw new ConflictException(
        `Ya existe un producto con el nombre '${trimmedName}' en tu institución.`,
      );
    }

    // Range validation: minAmount > 0 and maxAmount >= minAmount
    const min = Number(dto.minAmount);
    const max = Number(dto.maxAmount);
    if (isNaN(min) || min <= 0) {
      throw new BadRequestException("El monto mínimo debe ser mayor a cero.");
    }
    if (isNaN(max) || max < min) {
      throw new BadRequestException(
        "El monto máximo no puede ser inferior al monto mínimo.",
      );
    }

    if (!dto.purposes || !Array.isArray(dto.purposes) || dto.purposes.length === 0) {
      throw new BadRequestException(
        "Debes seleccionar al menos una finalidad para el producto.",
      );
    }

    const created = await this.db.run(async () => {
      const product = await this.db.client.financialProduct.create({
        data: {
          tenantId: ctx.tenantId,
          name: trimmedName,
          category: dto.category,
          applicantScope: dto.applicantScope,
          minAmount: min,
          maxAmount: max,
          maxDebtToIncome:
            dto.maxDebtToIncome !== undefined && dto.maxDebtToIncome !== null
              ? Number(dto.maxDebtToIncome)
              : null,
          minMonthlyDisposableIncome:
            dto.minMonthlyDisposableIncome !== undefined &&
            dto.minMonthlyDisposableIncome !== null
              ? Number(dto.minMonthlyDisposableIncome)
              : null,
          allowsRecentArrears: dto.allowsRecentArrears ?? false,
          active: dto.active ?? true,
        },
      });

      await this.db.client.financialProductPurpose.createMany({
        data: dto.purposes.map((p) => ({
          tenantId: ctx.tenantId,
          productId: product.id,
          purpose: p,
        })),
      });

      return product;
    });

    await this.audit.recordProductCatalogAction({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      productId: created.id,
      action: "PRODUCT_CREATED",
      metadata: { name: trimmedName, scope: dto.applicantScope },
    });

    return this.getById(ctx, created.id);
  }

  async update(
    ctx: TenantContext,
    productId: string,
    dto: UpdateProductDto,
  ): Promise<ProductCatalogItemDto> {
    this.checkAdmin(ctx);

    const existing = await this.db.client.financialProduct.findFirst({
      where: { id: productId, tenantId: ctx.tenantId },
      include: { purposes: true },
    });
    if (!existing) {
      throw new NotFoundException("Producto crediticio no encontrado.");
    }

    let targetName = existing.name;
    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (!trimmed || trimmed.length > 160) {
        throw new BadRequestException(
          "El nombre del producto es obligatorio y no puede superar los 160 caracteres.",
        );
      }
      if (trimmed.toLowerCase() !== existing.name.toLowerCase()) {
        const dup = await this.db.client.financialProduct.findFirst({
          where: {
            tenantId: ctx.tenantId,
            name: { equals: trimmed, mode: "insensitive" },
            id: { not: productId },
          },
        });
        if (dup) {
          throw new ConflictException(
            `Ya existe un producto con el nombre '${trimmed}' en tu institución.`,
          );
        }
      }
      targetName = trimmed;
    }

    const min =
      dto.minAmount !== undefined ? Number(dto.minAmount) : Number(existing.minAmount);
    const max =
      dto.maxAmount !== undefined ? Number(dto.maxAmount) : Number(existing.maxAmount);

    if (isNaN(min) || min <= 0) {
      throw new BadRequestException("El monto mínimo debe ser mayor a cero.");
    }
    if (isNaN(max) || max < min) {
      throw new BadRequestException(
        "El monto máximo no puede ser inferior al monto mínimo.",
      );
    }

    if (
      dto.purposes !== undefined &&
      (!Array.isArray(dto.purposes) || dto.purposes.length === 0)
    ) {
      throw new BadRequestException(
        "Debes seleccionar al menos una finalidad para el producto.",
      );
    }

    await this.db.run(async () => {
      await this.db.client.financialProduct.update({
        where: { id: productId },
        data: {
          name: targetName,
          category: dto.category ?? existing.category,
          applicantScope: dto.applicantScope ?? existing.applicantScope,
          minAmount: min,
          maxAmount: max,
          maxDebtToIncome:
            dto.maxDebtToIncome !== undefined
              ? dto.maxDebtToIncome !== null
                ? Number(dto.maxDebtToIncome)
                : null
              : existing.maxDebtToIncome,
          minMonthlyDisposableIncome:
            dto.minMonthlyDisposableIncome !== undefined
              ? dto.minMonthlyDisposableIncome !== null
                ? Number(dto.minMonthlyDisposableIncome)
                : null
              : existing.minMonthlyDisposableIncome,
          allowsRecentArrears:
            dto.allowsRecentArrears !== undefined
              ? dto.allowsRecentArrears
              : existing.allowsRecentArrears,
          active: dto.active !== undefined ? dto.active : existing.active,
        },
      });

      if (dto.purposes) {
        await this.db.client.financialProductPurpose.deleteMany({
          where: { tenantId: ctx.tenantId, productId },
        });
        await this.db.client.financialProductPurpose.createMany({
          data: dto.purposes.map((p) => ({
            tenantId: ctx.tenantId,
            productId,
            purpose: p,
          })),
        });
      }
    });

    await this.audit.recordProductCatalogAction({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      productId,
      action: "PRODUCT_UPDATED",
      metadata: { name: targetName },
    });

    return this.getById(ctx, productId);
  }

  async checkDeactivationImpact(
    tenantId: string,
    productId: string,
  ): Promise<DeactivationImpactDto> {
    const product = await this.db.client.financialProduct.findFirst({
      where: { id: productId, tenantId },
    });
    if (!product) {
      throw new NotFoundException("Producto crediticio no encontrado.");
    }

    if (!product.active) {
      return { isLastActive: false, scope: null };
    }

    const activeProducts = await this.db.client.financialProduct.findMany({
      where: { tenantId, active: true },
    });

    const companyActives = activeProducts.filter(
      (p) => p.applicantScope === "COMPANY" || p.applicantScope === "BOTH",
    );
    const isLastForCompany =
      (product.applicantScope === "COMPANY" || product.applicantScope === "BOTH") &&
      companyActives.length === 1 &&
      companyActives[0].id === productId;

    const personActives = activeProducts.filter(
      (p) => p.applicantScope === "PERSON" || p.applicantScope === "BOTH",
    );
    const isLastForPerson =
      (product.applicantScope === "PERSON" || product.applicantScope === "BOTH") &&
      personActives.length === 1 &&
      personActives[0].id === productId;

    if (isLastForCompany && isLastForPerson) {
      return {
        isLastActive: true,
        scope: "BOTH",
        warningMessage:
          "Este es el único producto activo de tu institución. Desactivarlo dejará a la institución sin productos configurados para nuevas evaluaciones de personas y empresas.",
      };
    }

    if (isLastForCompany) {
      return {
        isLastActive: true,
        scope: "COMPANY",
        warningMessage:
          "Este es el único producto activo aplicable a Empresa. Desactivarlo dejará a la institución sin productos configurados para nuevas evaluaciones empresariales.",
      };
    }

    if (isLastForPerson) {
      return {
        isLastActive: true,
        scope: "PERSON",
        warningMessage:
          "Este es el único producto activo aplicable a Persona. Desactivarlo dejará a la institución sin productos configurados para nuevas evaluaciones de personas naturales.",
      };
    }

    return {
      isLastActive: false,
      scope: null,
    };
  }

  async toggleStatus(
    ctx: TenantContext,
    productId: string,
    active: boolean,
    confirmImpact = false,
  ): Promise<ProductCatalogItemDto> {
    this.checkAdmin(ctx);

    const existing = await this.db.client.financialProduct.findFirst({
      where: { id: productId, tenantId: ctx.tenantId },
    });
    if (!existing) {
      throw new NotFoundException("Producto crediticio no encontrado.");
    }

    // CA-16.08, CA-16.12, PA-16.04: If deactivating, guard against last applicable product
    if (!active && existing.active) {
      const impact = await this.checkDeactivationImpact(ctx.tenantId, productId);
      if (impact.isLastActive && !confirmImpact) {
        throw new ConflictException({
          statusCode: 409,
          code: "LAST_ACTIVE_PRODUCT_WARNING",
          message: impact.warningMessage,
          scope: impact.scope,
        });
      }
    }

    await this.db.client.financialProduct.update({
      where: { id: productId },
      data: { active },
    });

    await this.audit.recordProductCatalogAction({
      tenantId: ctx.tenantId,
      actorUserId: ctx.userId,
      productId,
      action: active ? "PRODUCT_ACTIVATED" : "PRODUCT_DEACTIVATED",
      metadata: { name: existing.name },
    });

    return this.getById(ctx, productId);
  }

  private serialize(row: {
    id: string;
    tenantId: string;
    name: string;
    category: ProductCategory;
    applicantScope: ApplicantScope;
    minAmount: unknown;
    maxAmount: unknown;
    maxDebtToIncome: unknown;
    minMonthlyDisposableIncome: unknown;
    allowsRecentArrears: boolean;
    active: boolean;
    purposes?: Array<{ purpose: CreditPurpose }>;
    createdAt: Date;
    updatedAt: Date;
  }): ProductCatalogItemDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      name: row.name,
      category: row.category,
      applicantScope: row.applicantScope,
      minAmount: Number(row.minAmount),
      maxAmount: Number(row.maxAmount),
      maxDebtToIncome:
        row.maxDebtToIncome !== null && row.maxDebtToIncome !== undefined
          ? Number(row.maxDebtToIncome)
          : null,
      minMonthlyDisposableIncome:
        row.minMonthlyDisposableIncome !== null &&
        row.minMonthlyDisposableIncome !== undefined
          ? Number(row.minMonthlyDisposableIncome)
          : null,
      allowsRecentArrears: Boolean(row.allowsRecentArrears),
      active: Boolean(row.active),
      purposes: (row.purposes ?? []).map((p) => p.purpose),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
