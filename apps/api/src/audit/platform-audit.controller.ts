import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminAuthGuard, OperatorGuard } from "../identity-tenants/public.js";
import { AuditReader, PlatformAuditQueryDto, AuditPageDto } from "./public.js";

@ApiTags("Administración - auditoría operativa")
@ApiCookieAuth()
@Controller("admin/audit")
@UseGuards(AdminAuthGuard, OperatorGuard)
export class PlatformAuditController {
  constructor(private readonly auditReader: AuditReader) {}

  @Get()
  @ApiOperation({
    summary: "Consultar auditoría operativa de plataforma (Operador)",
    description:
      "Permite al operador de Doggy Software auditar eventos globales y de ciclo de vida de tenants sin acceso a datos crediticios individuales ni PII de solicitantes.",
  })
  async list(@Query() query: PlatformAuditQueryDto): Promise<AuditPageDto> {
    return this.auditReader.queryPlatformAudit(query);
  }
}
