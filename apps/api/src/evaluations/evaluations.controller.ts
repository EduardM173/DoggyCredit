import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags, ApiResponse } from "@nestjs/swagger";
import {
  InstitutionOriginGuard,
  InstitutionSessionGuard,
  TenantContextGuard,
  type TenantRequest,
} from "../identity-tenants/public.js";
import { DocumentDto, PrepareEvaluationDto } from "./evaluation.dto.js";
import { EvaluationsService } from "./evaluations.service.js";
@ApiTags("Evaluaciones")
@ApiCookieAuth()
@Controller("institution/tenants/:tenantSlug/evaluations")
@UseGuards(InstitutionSessionGuard, TenantContextGuard)
export class EvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}
  @Get("preparation")
  @ApiOperation({ summary: "Comprobar autorización y preparación antes de solicitar datos" })
  entry(@Req() req: TenantRequest) {
    return this.evaluations.entry(req.tenantContext);
  }
  @Post("lookup")
  @HttpCode(200)
  @UseGuards(InstitutionOriginGuard)
  @ApiOperation({ summary: "Buscar un expediente exclusivamente en la institución autorizada" })
  lookup(@Req() req: TenantRequest, @Body() body: DocumentDto) {
    return this.evaluations.lookup(req.tenantContext, body);
  }
  @Post()
  @HttpCode(201)
  @UseGuards(InstitutionOriginGuard)
  @ApiOperation({ summary: "Preparar un caso DRAFT sin consultar fuentes financieras" })
  @ApiResponse({ status: 400, description: "Datos o consentimiento inválidos" })
  @ApiResponse({ status: 409, description: "Preparación incompleta o envío conflictivo" })
  prepare(@Req() req: TenantRequest, @Body() body: PrepareEvaluationDto) {
    return this.evaluations.prepare(req.tenantContext, body);
  }
  @Get(":id")
  @ApiOperation({ summary: "Recuperar el caso conservado y su snapshot dentro del tenant" })
  detail(@Req() req: TenantRequest, @Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
    return this.evaluations.detail(req.tenantContext, id);
  }
}
