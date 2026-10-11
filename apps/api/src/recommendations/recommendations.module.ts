import { Module } from "@nestjs/common";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { AuditModule } from "../audit/audit.module.js";
import { PreparationProducts, EvaluationRecommender } from "./public.js";
import { PreparationProductsService } from "./preparation-products.service.js";
import { RecommendationService } from "./recommendation.service.js";
import { ProductsCatalogService } from "./products-catalog.service.js";
import { ProductsCatalogController } from "./products-catalog.controller.js";

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ProductsCatalogController],
  providers: [
    { provide: PreparationProducts, useClass: PreparationProductsService },
    { provide: EvaluationRecommender, useClass: RecommendationService },
    ProductsCatalogService,
  ],
  exports: [PreparationProducts, EvaluationRecommender, ProductsCatalogService],
})
export class RecommendationsModule {}
