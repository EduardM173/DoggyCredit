import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { environmentValidationSchema } from "./config/environment.js";
import { HealthController } from "./health.controller.js";
import { IdentityTenantsModule } from "./identity-tenants/identity-tenants.module.js";
import { PlansMeteringModule } from "./plans-metering/plans-metering.module.js";
import { OnboardingModule } from "./onboarding.module.js";
import { ClientsModule } from "./clients/public.js";
import { EvaluationsModule } from "./evaluations/public.js";
import { FinancialIntegrationsModule } from "./financial-integrations/financial-integrations.module.js";
import { FinancialProfileModule } from "./financial-profile/financial-profile.module.js";
import { PlatformProvidersModule } from "./platform-providers.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env"],
      validationSchema: environmentValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    IdentityTenantsModule,
    PlansMeteringModule,
    OnboardingModule,
    ClientsModule,
    EvaluationsModule,
    FinancialIntegrationsModule,
    FinancialProfileModule,
    PlatformProvidersModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
