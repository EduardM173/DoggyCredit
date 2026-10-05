import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module.js";
import { PaymentProvider } from "./payment-provider.js";
import { MockPaymentProvider } from "./mock-payment-provider.js";
@Module({
  imports: [PrismaModule],
  providers: [{ provide: PaymentProvider, useClass: MockPaymentProvider }],
  exports: [PaymentProvider],
})
export class PaymentsModule {}
