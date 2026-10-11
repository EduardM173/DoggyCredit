import { Module } from "@nestjs/common";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { ClientsModule } from "../clients/public.js";
import { AuditModule } from "../audit/audit.module.js";
import { IdentityTenantsModule } from "../identity-tenants/identity-tenants.module.js";
import { FinancialIntegrationsModule } from "../financial-integrations/financial-integrations.module.js";
import { FinancialProfileModule } from "../financial-profile/financial-profile.module.js";
import { RecommendationsModule } from "../recommendations/recommendations.module.js";
import { EvaluationsController } from "./evaluations.controller.js";
import { EvaluationsService } from "./evaluations.service.js";

@Module({
  imports: [
    PrismaModule,
    ClientsModule,
    AuditModule,
    IdentityTenantsModule,
    FinancialIntegrationsModule,
    FinancialProfileModule,
    RecommendationsModule,
  ],
  controllers: [EvaluationsController],
  providers: [EvaluationsService],
  exports: [EvaluationsService],
})
export class EvaluationsModule {}
