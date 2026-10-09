import { Module } from "@nestjs/common";
import { IdentityTenantsModule } from "./identity-tenants/identity-tenants.module.js";
import { ProvisionInstitutionService, TenantProvisioningWorker } from "./identity-tenants/public.js";
import { PlansMeteringModule } from "./plans-metering/plans-metering.module.js";
import { PrismaModule } from "./infrastructure/prisma/prisma.module.js";
import { EmailModule } from "./infrastructure/email/email.module.js";
import { AuditModule } from "./audit/audit.module.js";
import { ContractingApprovalController } from "./contracting-approval.controller.js";
import { ContractingApprovalService } from "./contracting-approval.service.js";
import { ContractingEmailDeliveryService } from "./plans-metering/public.js";

// Composition only: register the Identity-owned workflow with both public capabilities.
@Module({
  imports: [IdentityTenantsModule, PlansMeteringModule, PrismaModule, EmailModule, AuditModule],
  controllers: [ContractingApprovalController],
  providers: [
    ProvisionInstitutionService,
    TenantProvisioningWorker,
    ContractingEmailDeliveryService,
    ContractingApprovalService,
  ],
  exports: [TenantProvisioningWorker, ContractingEmailDeliveryService],
})
export class OnboardingModule {}
