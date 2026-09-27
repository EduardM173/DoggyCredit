import { Module } from "@nestjs/common";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { PublicPlansController } from "./public-plans.controller.js";
import { PublicPlansService } from "./public-plans.service.js";

@Module({
  imports: [PrismaModule],
  controllers: [PublicPlansController],
  providers: [PublicPlansService],
  exports: [PublicPlansService],
})
export class PlanCatalogModule {}
