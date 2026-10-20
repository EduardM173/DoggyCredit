import { Body, Controller, Header, HttpCode, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { CompletePasswordResetDto, RequestPasswordResetDto, ResetTokenDto } from "./password-recovery.dto.js";
import { PasswordRecoveryService } from "./password-recovery.service.js";

@ApiTags("Recuperación de acceso")
@Controller("password-recovery")
export class PasswordRecoveryController {
  constructor(private readonly recovery: PasswordRecoveryService) {}

  @Post("request")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @ApiOperation({ summary: "Solicitar enlace de recuperación sin revelar cuentas" })
  request(@Body() body: RequestPasswordResetDto, @Req() request: Request) {
    return this.recovery.request(body.email, request.socket.remoteAddress ?? "unknown");
  }

  @Post("preview")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @ApiOperation({ summary: "Comprobar enlace sin consumirlo" })
  preview(@Body() body: ResetTokenDto, @Req() request: Request) {
    return this.recovery.preview(body.token, request.socket.remoteAddress ?? "unknown");
  }

  @Post("complete")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  @Header("Referrer-Policy", "no-referrer")
  @ApiOperation({ summary: "Restablecer contraseña y revocar sesiones anteriores" })
  complete(@Body() body: CompletePasswordResetDto, @Req() request: Request) {
    return this.recovery.complete(
      body.token,
      body.password,
      body.confirmation,
      request.socket.remoteAddress ?? "unknown",
    );
  }
}
