import { Body, Controller, Get, Param, Patch, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { InstitutionOriginGuard, InstitutionSessionGuard } from "../institution-auth/institution-auth.guards.js";
import { TenantContextGuard, type TenantRequest } from "../institution-auth/tenant-context.guard.js";
import { InstitutionDataService } from "./institution-data.service.js";
import { UpdateInstitutionDataDto } from "./update-institution-data.dto.js";

@ApiTags("Portal institucional")
@Controller("institution/tenants/:tenantSlug/institution-data")
@UseGuards(InstitutionSessionGuard, TenantContextGuard)
export class InstitutionDataController {
  constructor(private readonly data: InstitutionDataService) {}

  @Get()
  @ApiCookieAuth()
  @ApiOperation({ summary: "Consultar datos institucionales editables y bloqueados con su procedencia" })
  read(@Param("tenantSlug") _slug: string, @Req() request: TenantRequest) {
    return this.data.read(request.tenantContext);
  }

  @Patch()
  @UseGuards(InstitutionOriginGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: "Actualizar solo los datos institucionales autorizados" })
  update(@Req() request: TenantRequest, @Body() body: UpdateInstitutionDataDto) {
    return this.data.update(request.tenantContext, body);
  }
}
