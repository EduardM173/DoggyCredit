import { forwardRef, Module } from "@nestjs/common";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { IdentityTenantsModule } from "../identity-tenants/identity-tenants.module.js";
import { AuditWriter, AuditReader } from "./public.js";
import { AuditService } from "./audit.service.js";
import { InstitutionAuditController } from "./institution-audit.controller.js";
import { PlatformAuditController } from "./platform-audit.controller.js";

@Module({
  imports: [PrismaModule, forwardRef(() => IdentityTenantsModule)],
  controllers: [InstitutionAuditController, PlatformAuditController],
  providers: [
    AuditService,
    { provide: AuditWriter, useExisting: AuditService },
    { provide: AuditReader, useExisting: AuditService },
  ],
  exports: [AuditWriter, AuditReader],
})
export class AuditModule {}
