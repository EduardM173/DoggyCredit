import { Module } from "@nestjs/common";
import { ClientsModule } from "../clients/clients.module.js";
import { IdentityTenantsModule } from "../identity-tenants/identity-tenants.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { EvaluationsService } from "./evaluations.service.js";
import { EvaluationsController } from "./evaluations.controller.js";
@Module({
  imports: [ClientsModule, IdentityTenantsModule, AuditModule, PrismaModule],
  controllers: [EvaluationsController],
  providers: [EvaluationsService],
})
export class EvaluationsModule {}
