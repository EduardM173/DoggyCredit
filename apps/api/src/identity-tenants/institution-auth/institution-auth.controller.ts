import { Body, Controller, Get, HttpCode, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { InstitutionAuthService } from "./institution-auth.service.js";
import { InstitutionLoginDto } from "./institution-login.dto.js";
import {
  InstitutionLoginRateGuard,
  InstitutionOriginGuard,
  InstitutionSessionGuard,
  institutionCookie,
  institutionToken,
  type InstitutionRequest,
} from "./institution-auth.guards.js";
import { TenantContextGuard, type TenantRequest } from "./tenant-context.guard.js";

@ApiTags("Portal institucional")
@Controller("institution/auth")
export class InstitutionAuthController {
  constructor(
    private readonly auth: InstitutionAuthService,
    private readonly config: ConfigService,
  ) {}
  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.get("NODE_ENV") === "production",
      sameSite: "strict" as const,
      path: "/",
    };
  }

  @Post("login")
  @HttpCode(200)
  @UseGuards(InstitutionOriginGuard, InstitutionLoginRateGuard)
  @ApiOperation({ summary: "Autenticar identidad institucional sin seleccionar tenant" })
  async login(
    @Body() body: InstitutionLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const production = this.config.get("NODE_ENV") === "production";
    const result = await this.auth.login(body.email, body.password, institutionToken(request, production));
    response.cookie(institutionCookie(production), result.token, {
      ...this.cookieOptions(),
      expires: result.expiresAt,
    });
    const memberships = result.view.activeMemberships;
    if (memberships.length === 0) return { authenticated: true, resolution: "NO_ACTIVE_TENANT" };
    if (memberships.length === 1)
      return { authenticated: true, resolution: "SINGLE_TENANT", tenant: memberships[0].tenant };
    return {
      authenticated: true,
      resolution: "MULTIPLE_TENANTS",
      tenants: memberships.map((row) => row.tenant),
    };
  }

  @Get("me")
  @UseGuards(InstitutionSessionGuard)
  @ApiCookieAuth()
  @ApiOperation({ summary: "Consultar identidad y membresías activas actuales" })
  me(@Req() request: InstitutionRequest) {
    return this.auth.me(request.institutionSession.user.id);
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(InstitutionOriginGuard)
  @ApiOperation({ summary: "Revocar solamente la sesión institucional actual" })
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const production = this.config.get("NODE_ENV") === "production";
    await this.auth.logout(institutionToken(request, production));
    response.clearCookie(institutionCookie(production), this.cookieOptions());
  }
}

@ApiTags("Portal institucional")
@Controller("institution/tenants/:tenantSlug")
@UseGuards(InstitutionSessionGuard, TenantContextGuard)
export class InstitutionTenantController {
  @Get("home")
  @ApiCookieAuth()
  @ApiOperation({ summary: "Espacio provisional del tenant autorizado" })
  home(@Param("tenantSlug") _slug: string, @Req() request: TenantRequest) {
    const ctx = request.tenantContext;
    return {
      user: { name: ctx.userName },
      tenant: { name: ctx.tenantName, slug: ctx.tenantSlug, taxId: ctx.taxId, type: ctx.institutionType },
      membership: { role: ctx.role, status: "ACTIVE" },
    };
  }
}
