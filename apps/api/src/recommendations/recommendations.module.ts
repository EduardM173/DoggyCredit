import { Module } from "@nestjs/common";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { PreparationProducts } from "./public.js";
import { PreparationProductsService } from "./preparation-products.service.js";

@Module({
  imports: [PrismaModule],
  providers: [{ provide: PreparationProducts, useClass: PreparationProductsService }],
  exports: [PreparationProducts],
})
export class RecommendationsModule {}
