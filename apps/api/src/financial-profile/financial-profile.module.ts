import { Module } from "@nestjs/common";
import { FinancialProfileService } from "./financial-profile.service.js";
import { FinancialProfileCalculator } from "./public.js";

@Module({
  providers: [
    {
      provide: FinancialProfileCalculator,
      useClass: FinancialProfileService,
    },
  ],
  exports: [FinancialProfileCalculator],
})
export class FinancialProfileModule {}
