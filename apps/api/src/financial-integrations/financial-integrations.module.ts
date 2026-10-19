import { Module } from "@nestjs/common";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { BankMockSource, BureauMockSource, ProviderAdministrationService } from "./public.js";
import { BankMockSourceService } from "./bank-mock-source.service.js";
import { BureauMockSourceService } from "./bureau-mock-source.service.js";
import { ResilientSources } from "./resilience/resilient-sources.js";

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [
    { provide: BankMockSource, useClass: BankMockSourceService },
    { provide: BureauMockSource, useClass: BureauMockSourceService },
    ResilientSources,
    ProviderAdministrationService,
  ],
  exports: [BankMockSource, BureauMockSource, ResilientSources, ProviderAdministrationService],
})
export class FinancialIntegrationsModule {}
