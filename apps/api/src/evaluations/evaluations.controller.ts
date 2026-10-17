import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import {
  InstitutionOriginGuard,
  InstitutionSessionGuard,
  TenantContextGuard,
  type TenantRequest,
} from "../identity-tenants/public.js";
import { EvaluationsService } from "./evaluations.service.js";
import { CreateEvaluationDto, DocumentTypeDto, ClientTypeDto } from "./dto/create-evaluation.dto.js";

@ApiTags("Evaluaciones crediticias")
@Controller("institution/tenants/:tenantSlug/evaluations")
@UseGuards(InstitutionSessionGuard, TenantContextGuard)
export class EvaluationsController {
  constructor(private readonly evaluations: EvaluationsService) {}

  @Get("readiness")
  @ApiCookieAuth()
  @ApiOperation({ summary: "Verificar si la institución cumple condiciones mínimas para evaluar" })
  checkReadiness(@Req() request: TenantRequest) {
    return this.evaluations.checkReadiness(request.tenantContext);
  }

  @Get("clients/search")
  @ApiCookieAuth()
  @ApiOperation({ summary: "Buscar expediente de cliente dentro del tenant por tipo y documento" })
  async searchClient(
    @Req() request: TenantRequest,
    @Query("documentType") documentType: DocumentTypeDto = DocumentTypeDto.CI,
    @Query("documentNumber") documentNumber = "",
    @Query("clientType") clientType: ClientTypeDto = ClientTypeDto.PERSON,
    @Res({ passthrough: true }) response: Response,
  ) {
    const client = await this.evaluations.searchClient(
      request.tenantContext,
      documentType,
      documentNumber,
      clientType,
    );
    if (!client) response.status(204);
    return client;
  }

  @Post()
  @UseGuards(InstitutionOriginGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: "Crear una nueva evaluación en estado DRAFT con snapshot de solicitante" })
  createDraft(@Req() request: TenantRequest, @Body() body: CreateEvaluationDto) {
    return this.evaluations.createDraft(request.tenantContext, body);
  }

  @Get()
  @ApiCookieAuth()
  @ApiOperation({ summary: "Listar evaluaciones del tenant con búsqueda, filtros y paginación" })
  list(
    @Req() request: TenantRequest,
    @Query("search") search?: string,
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("limit") limit?: string,
  ) {
    return this.evaluations.list(request.tenantContext, {
      search,
      status,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(":evaluationId")
  @ApiCookieAuth()
  @ApiOperation({ summary: "Obtener detalle de una evaluación por ID dentro del tenant" })
  getById(@Req() request: TenantRequest, @Param("evaluationId") evaluationId: string) {
    return this.evaluations.getById(request.tenantContext, evaluationId);
  }

  @Post(":evaluationId/process")
  @UseGuards(InstitutionOriginGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: "Procesar evaluación: consultar fuentes bancarias y derivar perfil financiero" })
  process(@Req() request: TenantRequest, @Param("evaluationId") evaluationId: string) {
    return this.evaluations.processEvaluation(request.tenantContext, evaluationId);
  }
}
