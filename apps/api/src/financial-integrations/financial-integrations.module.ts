import { Module } from "@nestjs/common";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { BankMockSource, BureauMockSource } from "./public.js";
import { BankMockSourceService } from "./bank-mock-source.service.js";
import { BureauMockSourceService } from "./bureau-mock-source.service.js";

@Module({
  imports: [PrismaModule],
  providers: [
    { provide: BankMockSource, useClass: BankMockSourceService },
    { provide: BureauMockSource, useClass: BureauMockSourceService },
  ],
  exports: [BankMockSource, BureauMockSource],
})
export class FinancialIntegrationsModule {}
