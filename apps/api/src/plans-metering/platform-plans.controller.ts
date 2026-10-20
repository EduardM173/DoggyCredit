import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import {
  AdminAuthGuard,
  AdminOriginGuard,
  PlatformAdminGuard,
  type AdminRequest,
} from "../identity-tenants/public.js";
import { CreatePlanDto, SetPlanStatusDto, UpdatePlanDto } from "./platform-plans.dto.js";
import { PlatformPlansService } from "./platform-plans.service.js";

@ApiTags("Administración - planes")
@ApiCookieAuth()
@Controller("admin/platform/plans")
@UseGuards(AdminAuthGuard, PlatformAdminGuard)
export class PlatformPlansController {
  constructor(private readonly plans: PlatformPlansService) {}

  @Get()
  list() {
    return this.plans.list();
  }

  @Post()
  @HttpCode(201)
  @UseGuards(AdminOriginGuard)
  create(@Body() body: CreatePlanDto, @Req() request: AdminRequest) {
    return this.plans.create(body, request.adminSession.user.id);
  }

  @Post(":id")
  @HttpCode(200)
  @UseGuards(AdminOriginGuard)
  update(@Param("id", ParseUUIDPipe) id: string, @Body() body: UpdatePlanDto, @Req() request: AdminRequest) {
    return this.plans.update(id, body, request.adminSession.user.id);
  }

  @Post(":id/status")
  @HttpCode(200)
  @UseGuards(AdminOriginGuard)
  setStatus(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: SetPlanStatusDto,
    @Req() request: AdminRequest,
  ) {
    return this.plans.setStatus(id, body, request.adminSession.user.id);
  }
}
