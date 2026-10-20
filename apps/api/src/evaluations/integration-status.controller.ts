import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  InstitutionSessionGuard,
  TenantContextGuard,
  type TenantRequest,
} from "../identity-tenants/public.js";
import { IntegrationStatusService } from "./integration-status.service.js";

@ApiTags("Estado de integraciones (institución)")
@Controller("institution/tenants/:tenantSlug/integrations")
@UseGuards(InstitutionSessionGuard, TenantContextGuard)
export class IntegrationStatusController {
  constructor(private readonly status: IntegrationStatusService) {}

  @Get("status")
  @ApiCookieAuth()
  @ApiOperation({ summary: "Disponibilidad de las fuentes habilitadas por la institución (solo lectura)" })
  getStatus(@Req() request: TenantRequest) {
    return this.status.forTenant(request.tenantContext.tenantId);
  }
}