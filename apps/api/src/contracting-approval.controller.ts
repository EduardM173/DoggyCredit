import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  AdminAuthGuard,
  AdminOriginGuard,
  ApproveRequestDto,
  OperatorGuard,
  type AdminRequest,
} from "./identity-tenants/public.js";
import { ContractingAccessService } from "./plans-metering/public.js";
import { ContractingApprovalService } from "./contracting-approval.service.js";

@ApiTags("Administración - solicitudes")
@ApiCookieAuth()
@Controller("admin/institution-requests")
@UseGuards(AdminAuthGuard, OperatorGuard)
export class ContractingApprovalController {
  constructor(
    private readonly approval: ContractingApprovalService,
    private readonly access: ContractingAccessService,
  ) {}

  @Post(":id/approve")
  @HttpCode(200)
  @UseGuards(AdminOriginGuard)
  @ApiOperation({ summary: "Aprobar y programar el correo de acceso a contratación" })
  async approve(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Req() request: AdminRequest,
    @Body() body: ApproveRequestDto,
  ) {
    void body;
    return this.approval.approve(id, request.adminSession.user.id);
  }

  @Get(":id/contracting-email")
  @ApiOperation({ summary: "Consultar entrega del acceso de contratación sin exponer el enlace" })
  status(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
    return this.access.emailStatus(id);
  }

  @Post(":id/contracting-email/resend")
  @HttpCode(200)
  @UseGuards(AdminOriginGuard)
  @ApiOperation({ summary: "Invalidar acceso anterior y reenviar el enlace al contacto verificado" })
  async resend(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() body: ApproveRequestDto,
  ) {
    void body;
    return this.approval.resend(id);
  }
}
