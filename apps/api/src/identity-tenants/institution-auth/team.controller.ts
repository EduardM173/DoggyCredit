import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { InstitutionOriginGuard, InstitutionSessionGuard } from "./institution-auth.guards.js";
import { TenantContextGuard, type TenantRequest } from "./tenant-context.guard.js";
import { InviteAnalystDto } from "./team.dto.js";
import { TeamService } from "./team.service.js";

@ApiTags("Portal institucional - equipo")
@ApiCookieAuth()
@Controller("institution/tenants/:tenantSlug/team")
@UseGuards(InstitutionSessionGuard, TenantContextGuard)
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  @ApiOperation({ summary: "Listar el equipo de la institución autorizada" })
  list(@Req() request: TenantRequest) {
    return this.team.list(request.tenantContext);
  }

  @Post("invitations")
  @HttpCode(200)
  @UseGuards(InstitutionOriginGuard)
  @ApiOperation({ summary: "Invitar a un analista al tenant actual" })
  invite(@Req() request: TenantRequest, @Body() body: InviteAnalystDto) {
    return this.team.invite(request.tenantContext, body.email);
  }

  @Post("invitations/:id/resend")
  @HttpCode(200)
  @UseGuards(InstitutionOriginGuard)
  @ApiOperation({ summary: "Reenviar invitación de analista del tenant actual" })
  resend(@Req() request: TenantRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
    return this.team.resend(request.tenantContext, id);
  }
}
