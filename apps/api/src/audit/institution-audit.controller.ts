import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  InstitutionSessionGuard,
  TenantContextGuard,
  type TenantRequest,
} from "../identity-tenants/public.js";
import { AuditReader, AuditQueryDto, AuditPageDto } from "./public.js";

@ApiTags("Portal institucional - auditoría")
@ApiCookieAuth()
@Controller("institution/tenants/:tenantSlug/audit")
@UseGuards(InstitutionSessionGuard, TenantContextGuard)
export class InstitutionAuditController {
  constructor(private readonly auditReader: AuditReader) {}

  @Get()
  @ApiOperation({
    summary: "Consultar eventos de auditoría y trazabilidad institucional (Ana)",
    description:
      "Permite a la administradora institucional consultar el rastro de auditoría de su entidad. Acceso estrictamente denegado a analistas.",
  })
  async list(
    @Req() request: TenantRequest,
    @Query() query: AuditQueryDto,
  ): Promise<AuditPageDto> {
    if (request.tenantContext.role !== "INSTITUTION_ADMIN") {
      throw new ForbiddenException(
        "Solo un administrador institucional puede consultar la auditoría de la institución.",
      );
    }

    return this.auditReader.queryInstitutionAudit(
      request.tenantContext.tenantId,
      query,
      request.tenantContext.tenantSlug,
    );
  }
}
