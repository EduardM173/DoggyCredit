import { Body, Controller, Header, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ActivationRateGuard } from "./activation-rate.guard.js";
import { ActivateInvitationDto, InvitationPreviewDto } from "./activation.dto.js";
import { ActivationService } from "./activation.service.js";

@ApiTags("Identity & Tenants")
@Controller("membership-invitations")
@UseGuards(ActivationRateGuard)
export class ActivationController {
  constructor(private readonly activation: ActivationService) {}

  @Post("preview")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @ApiOperation({ summary: "Consultar invitación institucional sin consumirla" })
  preview(@Body() body: InvitationPreviewDto) {
    return this.activation.preview(body.token);
  }

  @Post("activate")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @ApiOperation({ summary: "Consumir invitación y activar la membresía institucional" })
  activate(@Body() body: ActivateInvitationDto) {
    return this.activation.activate(body.token, body.password);
  }
}
