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
import { InstitutionDashboardController } from "./institution-dashboard.controller.js";
import { InstitutionDashboardService } from "./institution-dashboard.service.js";

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
  controllers: [EvaluationsController, InstitutionDashboardController],
  providers: [EvaluationsService, InstitutionDashboardService],
  exports: [EvaluationsService, InstitutionDashboardService],
})
export class EvaluationsModule {}
