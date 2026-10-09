import { Module } from "@nestjs/common";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { BankMockSource } from "./public.js";
import { BankMockSourceService } from "./bank-mock-source.service.js";

@Module({
  imports: [PrismaModule],
  providers: [{ provide: BankMockSource, useClass: BankMockSourceService }],
  exports: [BankMockSource],
})
export class FinancialIntegrationsModule {}
