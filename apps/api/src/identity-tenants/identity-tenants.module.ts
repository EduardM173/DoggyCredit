import { Module } from "@nestjs/common";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { EmailModule } from "../infrastructure/email/email.module.js";
import { EmailVerificationService } from "./email-verification/email-verification.service.js";
import { EmailVerificationController } from "./email-verification/email-verification.controller.js";
import { InstitutionRequestsController } from "./institution-requests/institution-requests.controller.js";
import { InstitutionRequestsService } from "./institution-requests/institution-requests.service.js";
import { AuditModule } from "../audit/audit.module.js";
import { AdminAuthController } from "./auth/admin-auth.controller.js";
import { AdminAuthService } from "./auth/admin-auth.service.js";
import {
  AdminAuthGuard,
  AdminOriginGuard,
  AdminLoginRateGuard,
  OperatorGuard,
} from "./auth/admin-auth.guards.js";
import { RequestReviewController } from "./request-review/request-review.controller.js";
import { RequestReviewService } from "./request-review/request-review.service.js";
import { RequestContextReader } from "./request-context.js";
import { ProvisioningQueue } from "./provisioning/provisioning-queue.js";
import { InstitutionsController } from "./institutions/institutions.controller.js";
import { InstitutionsService } from "./institutions/institutions.service.js";

@Module({
  imports: [PrismaModule, EmailModule, AuditModule],
  controllers: [
    InstitutionsController,
    InstitutionRequestsController,
    EmailVerificationController,
    AdminAuthController,
    RequestReviewController,
  ],
  providers: [
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
  ],
  exports: [
    ProvisioningQueue,
    RequestContextReader,
    AdminAuthService,
    AdminAuthGuard,
    AdminOriginGuard,
    OperatorGuard,
  ],
})
export class IdentityTenantsModule {}
