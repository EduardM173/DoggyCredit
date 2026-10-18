-- S4-HF-06: congelar producto y reglas evaluados junto a cada recomendación.
-- Nullable: las recomendaciones anteriores al hotfix no tienen snapshot y siguen
-- leyendo el producto vinculado como respaldo.
ALTER TABLE "EvaluationRecommendation" ADD COLUMN "productSnapshot" JSONB;
