import { forwardRef, Module } from "@nestjs/common";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { EmailModule } from "../infrastructure/email/email.module.js";
import { EmailVerificationService } from "./email-verification/email-verification.service.js";
import { EmailVerificationController } from "./email-verification/email-verification.controller.js";
import { InstitutionRequestsController } from "./institution-requests/institution-requests.controller.js";
import { InstitutionRequestsService } from "./institution-requests/institution-requests.service.js";
import { AuditModule } from "../audit/audit.module.js";
import { AdminAuthController } from "./auth/admin-auth.controller.js";
import { TestInboxController } from "./auth/test-inbox.controller.js";
import { AdminAuthService } from "./auth/admin-auth.service.js";
import {
  AdminAuthGuard,
  AdminOriginGuard,
  AdminLoginRateGuard,
  OperatorGuard,
} from "./auth/admin-auth.guards.js";
import { RequestReviewController } from "./request-review/request-review.controller.js";
import { RequestReviewService } from "./request-review/request-review.service.js";
import { RequestDecisionDeliveryService } from "./request-review/request-decision-delivery.service.js";
import { RequestContextReader } from "./request-context.js";
import { ProvisioningQueue } from "./provisioning/provisioning-queue.js";
import { InstitutionsController } from "./institutions/institutions.controller.js";
import { InstitutionsService } from "./institutions/institutions.service.js";
import { ActivationController } from "./activation/activation.controller.js";
import { ActivationService } from "./activation/activation.service.js";
import { ActivationRateGuard } from "./activation/activation-rate.guard.js";
import {
  InstitutionAuthController,
  InstitutionTenantController,
} from "./institution-auth/institution-auth.controller.js";
import { InstitutionAuthService } from "./institution-auth/institution-auth.service.js";
import {
  InstitutionLoginRateGuard,
  InstitutionOriginGuard,
  InstitutionSessionGuard,
} from "./institution-auth/institution-auth.guards.js";
import { TenantContextGuard } from "./institution-auth/tenant-context.guard.js";
import { PlanCatalogModule } from "../plans-metering/public.js";
import { FinancialIntegrationsModule } from "../financial-integrations/financial-integrations.module.js";
import { RecommendationsModule } from "../recommendations/recommendations.module.js";
import { TenantPreparationService } from "./institution-auth/tenant-preparation.service.js";
import { TeamController } from "./institution-auth/team.controller.js";
import { TeamService } from "./institution-auth/team.service.js";
import { InvitationDeliveryService } from "./provisioning/invitation-delivery.service.js";
import { InitialAdminRecoveryService } from "./provisioning/initial-admin-recovery.service.js";

@Module({
  imports: [
    PrismaModule,
    EmailModule,
    forwardRef(() => AuditModule),
    PlanCatalogModule,
    FinancialIntegrationsModule,
    forwardRef(() => RecommendationsModule),
  ],
  controllers: [
    InstitutionAuthController,
    InstitutionTenantController,
    TeamController,
    ActivationController,
    InstitutionsController,
    InstitutionRequestsController,
    EmailVerificationController,
    AdminAuthController,
    TestInboxController,
    RequestReviewController,
  ],
  providers: [
    TenantPreparationService,
    TeamService,
    InvitationDeliveryService,
    InitialAdminRecoveryService,
    InstitutionAuthService,
    InstitutionLoginRateGuard,
    InstitutionOriginGuard,
    InstitutionSessionGuard,
    TenantContextGuard,
    ActivationService,
    ActivationRateGuard,
    InstitutionsService,
    ProvisioningQueue,
    RequestContextReader,
    InstitutionRequestsService,
    EmailVerificationService,
    AdminAuthService,
    AdminAuthGuard,
    OperatorGuard,
    AdminOriginGuard,
    AdminLoginRateGuard,
    RequestReviewService,
    RequestDecisionDeliveryService,
  ],
  exports: [
    ProvisioningQueue,
    RequestContextReader,
    RequestReviewService,
    RequestDecisionDeliveryService,
    AdminAuthService,
    AdminAuthGuard,
    AdminOriginGuard,
    OperatorGuard,
    InvitationDeliveryService,
    InitialAdminRecoveryService,
    TenantContextGuard,
    InstitutionAuthService,
    InstitutionSessionGuard,
    InstitutionOriginGuard,
    TenantPreparationService,
  ],
})
export class IdentityTenantsModule {}
