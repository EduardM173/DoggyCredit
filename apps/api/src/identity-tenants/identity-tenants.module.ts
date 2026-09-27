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

@Module({
  imports: [PrismaModule, EmailModule, AuditModule],
  controllers: [
    InstitutionRequestsController,
    EmailVerificationController,
    AdminAuthController,
    RequestReviewController,
  ],
  providers: [
    InstitutionRequestsService,
    EmailVerificationService,
    AdminAuthService,
    AdminAuthGuard,
    OperatorGuard,
    AdminOriginGuard,
    AdminLoginRateGuard,
    RequestReviewService,
  ],
})
export class IdentityTenantsModule {}
