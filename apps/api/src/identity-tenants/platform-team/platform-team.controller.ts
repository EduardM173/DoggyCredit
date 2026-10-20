import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Injectable,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { AuditWriter } from "../../audit/public.js";
import {
  AdminAuthGuard,
  AdminOriginGuard,
  PlatformAdminGuard,
  type AdminRequest,
} from "../auth/admin-auth.guards.js";
import { ActivationRateGuard } from "../activation/activation-rate.guard.js";
import { AcceptOperatorDto, InviteOperatorDto, PlatformTokenDto } from "./platform-team.dto.js";
import { PlatformTeamService } from "./platform-team.service.js";

@Injectable()
export class PlatformTeamDeniedAuditGuard implements CanActivate {
  constructor(private readonly audit: AuditWriter) {}
  async canActivate(context: ExecutionContext) {
    const user = context.switchToHttp().getRequest<AdminRequest>().adminSession.user;
    if (user.platformRole !== "PLATFORM_ADMIN") {
      await this.audit.recordPlatformTeamEvent({
        actorUserId: user.id,
        action: "OPERATOR_ADMIN_DENIED",
        entityType: "User",
        entityId: user.id,
        metadata: { role: user.platformRole ?? "NONE", result: "DENIED" },
      });
    }
    return true;
  }
}

@ApiTags("Administración - equipo interno")
@ApiCookieAuth()
@Controller("admin/platform/team")
@UseGuards(AdminAuthGuard, PlatformTeamDeniedAuditGuard, PlatformAdminGuard)
export class PlatformTeamController {
  constructor(private readonly team: PlatformTeamService) {}

  @Get()
  list() {
    return this.team.list();
  }

  @Post("invitations")
  @HttpCode(200)
  @UseGuards(AdminOriginGuard)
  invite(@Req() req: AdminRequest, @Body() body: InviteOperatorDto) {
    return this.team.invite(req.adminSession.user.id, body.email, body.fullName);
  }

  @Post(":userId/resend")
  @HttpCode(200)
  @UseGuards(AdminOriginGuard)
  resend(@Req() req: AdminRequest, @Param("userId", ParseUUIDPipe) userId: string) {
    return this.team.resend(req.adminSession.user.id, userId);
  }

  @Post(":userId/suspend")
  @HttpCode(200)
  @UseGuards(AdminOriginGuard)
  suspend(@Req() req: AdminRequest, @Param("userId", ParseUUIDPipe) userId: string) {
    return this.team.changeAccess(req.adminSession.user.id, userId, "SUSPENDED");
  }

  @Post(":userId/revoke")
  @HttpCode(200)
  @UseGuards(AdminOriginGuard)
  revoke(@Req() req: AdminRequest, @Param("userId", ParseUUIDPipe) userId: string) {
    return this.team.changeAccess(req.adminSession.user.id, userId, "REVOKED");
  }

  @Post(":userId/reactivate")
  @HttpCode(200)
  @UseGuards(AdminOriginGuard)
  reactivate(@Req() req: AdminRequest, @Param("userId", ParseUUIDPipe) userId: string) {
    return this.team.reactivate(req.adminSession.user.id, userId);
  }
}

@ApiTags("Administración - activación de operador")
@Controller("platform-invitations")
@UseGuards(ActivationRateGuard)
export class PlatformInvitationController {
  constructor(private readonly team: PlatformTeamService) {}

  @Post("preview")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  preview(@Body() body: PlatformTokenDto) {
    return this.team.preview(body.token);
  }

  @Post("accept")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  accept(@Body() body: AcceptOperatorDto) {
    return this.team.accept(body.token, body.password);
  }
}
