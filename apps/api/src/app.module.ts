import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { environmentValidationSchema } from "./config/environment.js";
import { HealthController } from "./health.controller.js";
import { IdentityTenantsModule } from "./identity-tenants/identity-tenants.module.js";
import { PlansMeteringModule } from "./plans-metering/plans-metering.module.js";
import { OnboardingModule } from "./onboarding.module.js";
import { EvaluationsModule } from "./evaluations/evaluations.module.js";

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
    EvaluationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
