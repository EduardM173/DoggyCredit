import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminAuthGuard, OperatorGuard } from "../auth/admin-auth.guards.js";
import { InstitutionsService } from "./institutions.service.js";
import { InstitutionSearchDto } from "./institution-search.dto.js";

@ApiTags("Administración - instituciones")
@ApiCookieAuth()
@Controller("admin/institutions")
@UseGuards(AdminAuthGuard, OperatorGuard)
export class InstitutionsController {
  constructor(private readonly institutions: InstitutionsService) {}

  @Get()
  @ApiOperation({ summary: "Instituciones aprovisionadas y estado de su administrador inicial" })
  list(@Query() query: InstitutionSearchDto) {
    return this.institutions.list(query);
  }

  @Get(":id")
  @ApiOperation({ summary: "Resumen operativo institucional (plan, consumo RF-03, salud de fuentes y miembros)" })
  getDetail(@Param("id") id: string) {
    return this.institutions.getDetail(id);
  }
}
