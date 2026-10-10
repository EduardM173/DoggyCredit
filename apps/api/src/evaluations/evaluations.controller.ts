import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  InstitutionOriginGuard,
  InstitutionSessionGuard,
  TenantContextGuard,
  type TenantRequest,
} from "../identity-tenants/public.js";
import { EvaluationsService } from "./evaluations.service.js";
import { CreateEvaluationDto, DocumentTypeDto } from "./dto/create-evaluation.dto.js";

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
  @ApiOperation({ summary: "Buscar expediente de cliente dentro del tenant por documento" })
  searchClient(
    @Req() request: TenantRequest,
    @Query("documentType") documentType: DocumentTypeDto = DocumentTypeDto.CI,
    @Query("documentNumber") documentNumber = "",
  ) {
    return this.evaluations.searchClient(
      request.tenantContext,
      documentType,
      documentNumber,
    );
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
  @ApiOperation({ summary: "Listar evaluaciones recientes del tenant" })
  list(@Req() request: TenantRequest) {
    return this.evaluations.list(request.tenantContext);
  }

  @Get(":evaluationId")
  @ApiCookieAuth()
  @ApiOperation({ summary: "Obtener detalle de una evaluación por ID dentro del tenant" })
  getById(@Req() request: TenantRequest, @Param("evaluationId") evaluationId: string) {
    return this.evaluations.getById(request.tenantContext, evaluationId);
  }
}
