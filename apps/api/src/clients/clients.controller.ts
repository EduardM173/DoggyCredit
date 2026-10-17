import { Controller, Get, Param, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  InstitutionSessionGuard,
  TenantContextGuard,
  type TenantRequest,
} from "../identity-tenants/public.js";
import { ClientsService } from "./clients.service.js";

@ApiTags("Expedientes de clientes")
@Controller("institution/tenants/:tenantSlug/clients")
@UseGuards(InstitutionSessionGuard, TenantContextGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get(":clientId")
  @ApiCookieAuth()
  @ApiOperation({ summary: "Consultar expediente y evaluaciones del solicitante dentro del tenant" })
  getDossier(@Req() request: TenantRequest, @Param("clientId") clientId: string) {
    return this.clients.getDossier(request.tenantContext, clientId);
  }
}
