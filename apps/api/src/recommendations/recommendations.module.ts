import { Module } from "@nestjs/common";
import { PrismaModule } from "../infrastructure/prisma/prisma.module.js";
import { PreparationProducts, EvaluationRecommender } from "./public.js";
import { PreparationProductsService } from "./preparation-products.service.js";
import { RecommendationService } from "./recommendation.service.js";

@Module({
  imports: [PrismaModule],
  providers: [
    { provide: PreparationProducts, useClass: PreparationProductsService },
    { provide: EvaluationRecommender, useClass: RecommendationService },
  ],
  exports: [PreparationProducts, EvaluationRecommender],
})
export class RecommendationsModule {}
