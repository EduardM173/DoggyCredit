import { Module } from "@nestjs/common";
import { IdentityTenantsModule } from "./identity-tenants/identity-tenants.module.js";
import { FinancialIntegrationsModule } from "./financial-integrations/financial-integrations.module.js";
import { PlatformProvidersController } from "./platform-providers.controller.js";

// Composición únicamente: guards de Identity + administración de proveedores de Financial Integrations.
@Module({
  imports: [IdentityTenantsModule, FinancialIntegrationsModule],
  controllers: [PlatformProvidersController],
})
export class PlatformProvidersModule {}
