import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminAuthGuard, InternalStaffGuard } from "./identity-tenants/public.js";
// Import directo (no desde public.ts) para no ampliar el ciclo de imports de financial-integrations.
import { ProviderHealthReadService } from "./financial-integrations/public.js";

/**
 * HU-23 — Salud observada de Bank/Buró Mock para personal interno (OPERATOR y PLATFORM_ADMIN).
 * SOLO LECTURA: ningún GET cambia estado ni "marca recuperación" (CA-23.08).
 * No devuelve URLs, credenciales, payloads ni datos de solicitantes (CA-23.03/.09).
 */
@ApiTags("Plataforma - integraciones")
@ApiCookieAuth()
@Controller("admin/platform/integrations")
@UseGuards(AdminAuthGuard, InternalStaffGuard)
export class PlatformIntegrationsController {
  constructor(private readonly health: ProviderHealthReadService) {}

  @Get()
  @ApiOperation({ summary: "Salud observada de Bank Mock y Buró Mock (agregada, sin datos de solicitantes)" })
  list() {
    return this.health.list();
  }

  @Get(":code")
  @ApiOperation({ summary: "Diagnóstico operativo de un proveedor: estado, explicación, siguiente paso y episodio" })
  detail(@Param("code") code: string) {
    return this.health.detail(code);
  }
}