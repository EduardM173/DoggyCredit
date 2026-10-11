export type SelectableProduct = {
  id: string;
  name: string;
  category: string;
  applicantScope: string;
  minAmount: string;
  maxAmount: string;
  purposes: string[];
  selected: boolean;
};

export abstract class PreparationProducts {
  abstract list(tenantId: string): Promise<SelectableProduct[]>;
  abstract select(tenantId: string, ids: string[]): Promise<boolean>;
}

export type RecommendationReasonDto = {
  code: string;
  message: string;
  passed: boolean;
};

export type ProductRecommendationDto = {
  id: string;
  productId: string;
  productName: string;
  category: string;
  outcome: "RECOMMENDED" | "NOT_COMPATIBLE";
  ruleVersion: string;
  minAmount: number;
  maxAmount: number;
  evaluatedAt: Date;
  reasons: RecommendationReasonDto[];
};

export abstract class EvaluationRecommender {
  abstract evaluate(
    tenantId: string,
    evaluationId: string,
    context: {
      applicantScope: string;
      purpose: string;
      requestedAmount: number;
      profile: {
        averageMonthlyIncome: number | null;
        averageMonthlyExpenses: number | null;
        disposableIncome: number | null;
        totalDebt: number | null;
        activeCredits: number | null;
        debtToIncome: number | null;
        hasRecentArrears: boolean | null;
        completeness: number;
      };
    },
  ): Promise<ProductRecommendationDto[]>;
}
