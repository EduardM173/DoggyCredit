import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import {
  InstitutionSessionGuard,
  TenantContextGuard,
  type TenantRequest,
} from "../identity-tenants/public.js";
import {
  InstitutionDashboardService,
  type DashboardPeriod,
  type DashboardMetricsDto,
} from "./institution-dashboard.service.js";

@ApiTags("Dashboard institucional")
@Controller("institution/tenants/:tenantSlug/dashboard")
@UseGuards(InstitutionSessionGuard, TenantContextGuard)
export class InstitutionDashboardController {
  constructor(private readonly dashboard: InstitutionDashboardService) {}

  @Get()
  @ApiCookieAuth()
  @ApiOperation({
    summary: "Consultar métricas operativas, pendientes de atención y estado del dashboard institucional",
  })
  @ApiQuery({
    name: "period",
    required: false,
    enum: ["today", "last_7_days", "last_30_days", "month_to_date"],
    description: "Período temporal para el cálculo de métricas agregadas (por defecto: last_30_days)",
  })
  getDashboard(
    @Req() request: TenantRequest,
    @Query("period") period?: DashboardPeriod,
  ): Promise<DashboardMetricsDto> {
    return this.dashboard.getDashboard(request.tenantContext, period);
  }
}
