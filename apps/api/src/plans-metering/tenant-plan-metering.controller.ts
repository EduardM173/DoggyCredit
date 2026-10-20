import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  InstitutionSessionGuard,
  TenantContextGuard,
  type TenantRequest,
} from "../identity-tenants/public.js";
import {
  TenantPlanMeteringService,
  type TenantPlanMeteringDto,
} from "./tenant-plan-metering.service.js";

@ApiTags("Plan y consumo institucional")
@Controller("institution/tenants/:tenantSlug/plan-metering")
@UseGuards(InstitutionSessionGuard, TenantContextGuard)
export class TenantPlanMeteringController {
  constructor(private readonly planMeteringService: TenantPlanMeteringService) {}

  @Get()
  @ApiCookieAuth()
  @ApiOperation({
    summary: "Consultar plan contratado, capacidades de procesamiento y consumo medido de la institución (HU-21)",
  })
  async getPlanAndUsage(@Req() req: TenantRequest): Promise<TenantPlanMeteringDto> {
    const ctx = req.tenantContext;
    return this.planMeteringService.getTenantPlanAndUsage(ctx.tenantId, ctx.role);
  }
}
