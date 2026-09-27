import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { AdminAuthService } from "./admin-auth.service.js";
import {
  ADMIN_COOKIE,
  AdminAuthGuard,
  AdminLoginRateGuard,
  AdminOriginGuard,
  OperatorGuard,
  sessionToken,
  type AdminRequest,
} from "./admin-auth.guards.js";
import { AdminLoginDto } from "./admin-login.dto.js";

@ApiTags("Administración - sesión")
@Controller("admin/auth")
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    private readonly config: ConfigService,
  ) {}
  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.get("NODE_ENV") === "production",
      sameSite: "strict" as const,
      path: "/api/admin",
    };
  }

  @Post("login")
  @HttpCode(200)
  @UseGuards(AdminOriginGuard, AdminLoginRateGuard)
  @ApiOperation({ summary: "Iniciar sesión interna como OPERATOR" })
  async login(
    @Body() body: AdminLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(body.email, body.password, sessionToken(request));
    response.cookie(ADMIN_COOKIE, result.token, {
      ...this.cookieOptions(),
      expires: new Date(result.view.expiresAt),
    });
    return result.view;
  }

  @Get("session")
  @UseGuards(AdminAuthGuard, OperatorGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: "Consultar identidad y expiración de la sesión" })
  session(@Req() request: AdminRequest) {
    return request.adminSession;
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(AdminOriginGuard)
  @ApiOperation({ summary: "Revocar sesión y eliminar cookie, incluso si ya expiró" })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(sessionToken(request));
    response.clearCookie(ADMIN_COOKIE, this.cookieOptions());
  }
}
