import { Module } from "@nestjs/common";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { ClientsModule } from "../clients/public.js";
import { AuditModule } from "../audit/audit.module.js";
import { IdentityTenantsModule } from "../identity-tenants/identity-tenants.module.js";
import { EvaluationsController } from "./evaluations.controller.js";
import { EvaluationsService } from "./evaluations.service.js";

@Module({
  imports: [PrismaModule, ClientsModule, AuditModule, IdentityTenantsModule],
  controllers: [EvaluationsController],
  providers: [EvaluationsService],
  exports: [EvaluationsService],
})
export class EvaluationsModule {}
