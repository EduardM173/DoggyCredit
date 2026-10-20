import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import { AuditWriter } from "../../audit/public.js";
import type { TenantContext } from "../institution-auth/tenant-context.guard.js";
import type { UpdateInstitutionDataDto } from "./update-institution-data.dto.js";

export const INSTITUTION_DATA_SUPPORT_MESSAGE =
  "Para solicitar cambios en datos legales o contractuales, contacte a Soporte de Doggy Software.";

export interface InstitutionFieldDto {
  key: string;
  label: string;
  value: string | null;
  provenance: string;
  editable: boolean;
}

export interface InstitutionDataDto {
  tenantSlug: string;
  fields: InstitutionFieldDto[];
  supportMessage: string;
}

@Injectable()
export class InstitutionDataService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly audit: AuditWriter,
  ) {}

  private admin(ctx: TenantContext) {
    if (ctx.role !== "INSTITUTION_ADMIN")
      throw new ForbiddenException("Solo un administrador institucional puede actualizar los datos.");
  }

  private async lockTenant(tenantId: string) {
    await this.db.client.$queryRaw`SELECT id FROM "Tenant" WHERE id=${tenantId}::uuid FOR UPDATE`;
  }

  async read(ctx: TenantContext): Promise<InstitutionDataDto> {
    const tenant = await this.db.client.tenant.findUniqueOrThrow({
      where: { id: ctx.tenantId },
      select: {
        slug: true,
        legalName: true,
        taxId: true,
        publicAddress: true,
        contactPhone: true,
        contactEmail: true,
        supportPhone: true,
        supportEmail: true,
        createdFromRequest: {
          select: { contactName: true, contactRole: true, reviewedAt: true },
        },
      },
    });
    const requestProvenance = tenant.createdFromRequest
      ? "Registrado durante la incorporación (solicitud aprobada)."
      : "Dato base de la institución.";
    const editableProvenance = "Editable por el administrador de la institución.";
    const fields: InstitutionFieldDto[] = [
      {
        key: "legalName",
        label: "Razón social",
        value: tenant.legalName,
        provenance: requestProvenance,
        editable: false,
      },
      {
        key: "taxId",
        label: "NIT",
        value: tenant.taxId,
        provenance: requestProvenance,
        editable: false,
      },
      {
        key: "tenantSlug",
        label: "Identificador de la institución (tenantSlug)",
        value: tenant.slug,
        provenance: "Asignado por la plataforma al aprovisionar la institución.",
        editable: false,
      },
      {
        key: "contractualResponsible",
        label: "Responsable contractual",
        value: tenant.createdFromRequest
          ? `${tenant.createdFromRequest.contactName} — ${tenant.createdFromRequest.contactRole}`
          : null,
        provenance: "Informado en la solicitud de acceso y aprobado por Doggy Software.",
        editable: false,
      },
      {
        key: "publicAddress",
        label: "Dirección pública",
        value: tenant.publicAddress,
        provenance: editableProvenance,
        editable: true,
      },
      {
        key: "contactPhone",
        label: "Teléfono de contacto visible",
        value: tenant.contactPhone,
        provenance: editableProvenance,
        editable: true,
      },
      {
        key: "contactEmail",
        label: "Correo de contacto visible",
        value: tenant.contactEmail,
        provenance: editableProvenance,
        editable: true,
      },
      {
        key: "supportPhone",
        label: "Teléfono de soporte",
        value: tenant.supportPhone,
        provenance: editableProvenance,
        editable: true,
      },
      {
        key: "supportEmail",
        label: "Correo de soporte",
        value: tenant.supportEmail,
        provenance: editableProvenance,
        editable: true,
      },
    ];
    return { tenantSlug: tenant.slug, fields, supportMessage: INSTITUTION_DATA_SUPPORT_MESSAGE };
  }

  async update(ctx: TenantContext, input: UpdateInstitutionDataDto): Promise<InstitutionDataDto> {
    this.admin(ctx);
    const allowed = ["publicAddress", "contactPhone", "contactEmail", "supportPhone", "supportEmail"] as const;
    const provided = Object.fromEntries(
      allowed
        .filter((key) => input[key] !== undefined)
        .map((key) => [key, input[key] as unknown]),
    );
    if (Object.keys(provided).length === 0)
      throw new BadRequestException("No se enviaron campos autorizados para actualizar.");
    return this.db.run(async () => {
      await this.lockTenant(ctx.tenantId);
      const before = await this.db.client.tenant.findUniqueOrThrow({
        where: { id: ctx.tenantId },
        select: { publicAddress: true, contactPhone: true, contactEmail: true, supportPhone: true, supportEmail: true },
      });
      const changedFields = allowed
        .filter((key) => provided[key] !== undefined)
        .filter((key) => (before[key] ?? null) !== (provided[key] as string | null ?? null));
      if (changedFields.length > 0) {
        await this.db.client.tenant.update({
          where: { id: ctx.tenantId },
          data: provided,
        });
        await this.audit.recordInstitutionDataUpdate({
          tenantId: ctx.tenantId,
          actorUserId: ctx.userId,
          changedFields: [...changedFields],
        });
      }
      return this.read(ctx);
    });
  }
}
