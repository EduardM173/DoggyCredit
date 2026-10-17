import { Module } from "@nestjs/common";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { FinancialProfileService } from "./financial-profile.service.js";
import { FinancialProfileCalculator } from "./public.js";

@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: FinancialProfileCalculator,
      useClass: FinancialProfileService,
    },
  ],
  exports: [FinancialProfileCalculator],
})
export class FinancialProfileModule {}
