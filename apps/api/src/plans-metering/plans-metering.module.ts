import { Module } from "@nestjs/common";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { PaymentsModule } from "../infrastructure/payments/payments.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { IdentityTenantsModule } from "../identity-tenants/identity-tenants.module.js";
import { ContractingAccessService } from "./contracting-access.service.js";
import { ContractingService } from "./contracting.service.js";
import { PaymentEventProcessor } from "./payment-event-processor.js";
import { ProvisioningPlans } from "./provisioning-contract.js";
import { ProvisioningPlansService } from "./provisioning-plans.service.js";
import { ContractingGuard, PaymentPublicRateGuard } from "./contracting.guards.js";
import { PlanCatalogModule } from "./plan-catalog.module.js";
import {
  ContractingController,
  AdminContractingController,
  MockPaymentController,
} from "./contracting.controller.js";
import { TenantPlanMeteringController } from "./tenant-plan-metering.controller.js";
import { TenantPlanMeteringService } from "./tenant-plan-metering.service.js";

@Module({
  imports: [PrismaModule, PaymentsModule, AuditModule, IdentityTenantsModule, PlanCatalogModule],
  controllers: [
    ContractingController,
    AdminContractingController,
    MockPaymentController,
    TenantPlanMeteringController,
  ],
  providers: [
    { provide: ProvisioningPlans, useClass: ProvisioningPlansService },
    ContractingAccessService,
    ContractingService,
    PaymentEventProcessor,
    ContractingGuard,
    PaymentPublicRateGuard,
    TenantPlanMeteringService,
  ],
  exports: [ProvisioningPlans, ContractingAccessService, TenantPlanMeteringService],
})
export class PlansMeteringModule {}
