import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import {
  AdminAuthGuard,
  AdminOriginGuard,
  OperatorGuard,
  type AdminRequest,
} from "./identity-tenants/public.js";
import { EmptyCommerceDto } from "./plans-metering/public.js";
import { OnboardingRecoveryService } from "./onboarding-recovery.service.js";

@ApiTags("Administración - recuperación de altas")
@ApiCookieAuth()
@Controller("admin/contractings")
@UseGuards(AdminAuthGuard, OperatorGuard, AdminOriginGuard)
export class OnboardingRecoveryController {
  constructor(private readonly recovery: OnboardingRecoveryService) {}

  @Post(":id/provisioning/retry")
  @HttpCode(200)
  retry(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Req() req: AdminRequest,
    @Body() body: EmptyCommerceDto,
  ) {
    void body;
    return this.recovery.retryProvisioning(id, req.adminSession.user.id);
  }

  @Post(":id/initial-invitation/resend")
  @HttpCode(200)
  resend(
    @Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Req() req: AdminRequest,
    @Body() body: EmptyCommerceDto,
  ) {
    void body;
    return this.recovery.resendInitialInvitation(id, req.adminSession.user.id);
  }
}
