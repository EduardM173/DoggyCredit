import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  AdminAuthGuard,
  AdminOriginGuard,
  OperatorGuard,
  type AdminRequest,
} from "../auth/admin-auth.guards.js";
import { RequestReviewService } from "./request-review.service.js";
import { RequestSearchDto, ReviewDecisionDto } from "./request-review.dto.js";

@ApiTags("Administración - solicitudes")
@ApiCookieAuth()
@Controller("admin/institution-requests")
@UseGuards(AdminAuthGuard, OperatorGuard)
export class RequestReviewController {
  constructor(private readonly review: RequestReviewService) {}
  @Get()
  @ApiOperation({ summary: "Buscar y paginar solicitudes" })
  list(@Query() query: RequestSearchDto) {
    return this.review.list(query);
  }
  @Get(":id")
  @ApiOperation({ summary: "Consultar detalle sin tokens ni datos financieros" })
  detail(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string) {
    return this.review.detail(id);
  }
  @Post(":id/reject")
  @HttpCode(200)
  @UseGuards(AdminOriginGuard)
  @ApiOperation({ summary: "Rechazar solicitud sin eliminarla" })
  reject(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Req() request: AdminRequest,
    @Body() body: ReviewDecisionDto,
  ) {
    return this.review.decide(id, request.adminSession.user.id, "REJECTED", body.reason);
  }
}
