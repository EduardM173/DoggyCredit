import { Module } from "@nestjs/common";
import { IdentityTenantsModule } from "./identity-tenants/identity-tenants.module.js";
import { FinancialIntegrationsModule } from "./financial-integrations/financial-integrations.module.js";
import { PlatformProvidersController } from "./platform-providers.controller.js";
import { PlatformIntegrationsController } from "./platform-integrations.controller.js";

// Composición únicamente: guards de Identity + administración y salud de proveedores de Financial Integrations.
@Module({
  imports: [IdentityTenantsModule, FinancialIntegrationsModule],
  controllers: [PlatformProvidersController, PlatformIntegrationsController],
})
export class PlatformProvidersModule {}