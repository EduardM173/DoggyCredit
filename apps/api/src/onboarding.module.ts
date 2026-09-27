import { Module } from "@nestjs/common";
import { IdentityTenantsModule } from "./identity-tenants/identity-tenants.module.js";
import {
  ProvisionInstitutionService,
  TenantProvisioningWorker,
  InvitationDeliveryService,
} from "./identity-tenants/public.js";
import { PlansMeteringModule } from "./plans-metering/plans-metering.module.js";
import { PrismaModule } from "./infrastructure/prisma/prisma.module.js";
import { EmailModule } from "./infrastructure/email/email.module.js";
import { AuditModule } from "./audit/audit.module.js";

// Composition only: register the Identity-owned workflow with both public capabilities.
@Module({
  imports: [IdentityTenantsModule, PlansMeteringModule, PrismaModule, EmailModule, AuditModule],
  providers: [ProvisionInstitutionService, TenantProvisioningWorker, InvitationDeliveryService],
  exports: [TenantProvisioningWorker],
})
export class OnboardingModule {}
