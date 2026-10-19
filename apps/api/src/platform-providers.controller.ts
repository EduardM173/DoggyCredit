import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";
import {
  AdminAuthGuard,
  AdminOriginGuard,
  PlatformAdminGuard,
  type AdminRequest,
} from "./identity-tenants/public.js";
import { ProviderAdministrationService } from "./financial-integrations/public.js";

/** Solo estos dos campos son editables (CA-30.04): no hay URLs, claves, tokens ni timeouts. */
export class SetProviderGlobalStatusDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/**
 * HU-30 — Administración de proveedores simulados por PLATFORM_ADMIN.
 * Composición: guards de Identity + servicio de Financial Integrations. El slug no autoriza nada.
 */
@ApiTags("Administración - proveedores")
@ApiCookieAuth()
@Controller("admin/platform/providers")
@UseGuards(AdminAuthGuard, PlatformAdminGuard)
export class PlatformProvidersController {
  constructor(private readonly providers: ProviderAdministrationService) {}

  @Get()
  @ApiOperation({ summary: "Listar proveedores simulados con habilitación global, salud y cobertura" })
  list() {
    return this.providers.list();
  }

  @Get(":code")
  @ApiOperation({ summary: "Consultar un proveedor simulado (sin secretos ni datos de solicitantes)" })
  detail(@Param("code") code: string) {
    return this.providers.detail(code);
  }

  @Post(":code/global-status")
  @HttpCode(200)
  @UseGuards(AdminOriginGuard)
  @ApiOperation({ summary: "Habilitar o deshabilitar globalmente un proveedor para nuevas consultas" })
  setGlobalStatus(
    @Param("code") code: string,
    @Body() body: SetProviderGlobalStatusDto,
    @Req() request: AdminRequest,
  ) {
    return this.providers.setGlobalEnabled(code, body.enabled, request.adminSession.user.id, body.reason);
  }
}
