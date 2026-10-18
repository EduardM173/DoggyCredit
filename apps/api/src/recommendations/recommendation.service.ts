import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import {
  EvaluationRecommender,
  type ProductRecommendationDto,
  type RecommendationReasonDto,
} from "./public.js";

const DEFAULT_MAX_DTI = 0.4;
const RULE_VERSION = "1.0.0";

type EvaluationContext = Parameters<EvaluationRecommender["evaluate"]>[2];

const CATEGORY_ORDER: Record<string, number> = {
  MICRO_CREDIT: 1,
  GREEN_CREDIT: 2,
  SME_CREDIT: 3,
};

@Injectable()
export class RecommendationService extends EvaluationRecommender {
  constructor(private readonly db: DatabaseUnitOfWork) {
    super();
  }

  /**
   * S4-HF-06: lee el catálogo una sola vez y persiste recomendaciones, razones y
   * snapshot del producto dentro de una unidad de trabajo atómica, de modo que una
   * edición concurrente del catálogo no deje una operación a medias ni mezclada.
   */
  async evaluate(
    tenantId: string,
    evaluationId: string,
    context: EvaluationContext,
  ): Promise<ProductRecommendationDto[]> {
    return this.db.run(() => this.evaluateWithinUnitOfWork(tenantId, evaluationId, context));
  }

  private async evaluateWithinUnitOfWork(
    tenantId: string,
    evaluationId: string,
    context: EvaluationContext,
  ): Promise<ProductRecommendationDto[]> {
    // CA-12.02 & CA-12.03: Only active products belonging strictly to this tenant
    const products = await this.db.client.financialProduct.findMany({
      where: { tenantId, active: true },
      include: { purposes: true },
      orderBy: { name: "asc" },
    });

    const evaluatedResults: ProductRecommendationDto[] = [];

    for (const product of products) {
      const reasons: RecommendationReasonDto[] = [];

      // 1. Applicant Scope Rule (CA-17.03, PA-17.01, PA-17.02)
      const scopePassed =
        product.applicantScope === "BOTH" || product.applicantScope === context.applicantScope;
      reasons.push({
        code: "RULE_APPLICANT_SCOPE",
        message: scopePassed
          ? context.applicantScope === "COMPANY"
            ? "Producto habilitado para empresas y personas jurídicas."
            : "Producto habilitado para personas naturales."
          : context.applicantScope === "COMPANY"
            ? "El producto está destinado exclusivamente a personas naturales."
            : "El producto está destinado exclusivamente a empresas o personas jurídicas.",
        passed: scopePassed,
        status: scopePassed ? "PASSED" : "FAILED",
      });

      // 2. Credit Purpose Rule
      const purposePassed = product.purposes.some((p) => p.purpose === context.purpose);
      reasons.push({
        code: "RULE_PURPOSE",
        message: purposePassed
          ? "Finalidad del crédito admitida para este producto."
          : "La finalidad solicitada no se encuentra contemplada en este producto.",
        passed: purposePassed,
        status: purposePassed ? "PASSED" : "FAILED",
      });

      // 3. Amount Range Rule
      const minAmount = Number(product.minAmount);
      const maxAmount = Number(product.maxAmount);
      const amountPassed =
        context.requestedAmount >= minAmount && context.requestedAmount <= maxAmount;
      let amountMsg = `Monto solicitado dentro del rango permitido (Bs. ${minAmount.toLocaleString("es-BO")} - Bs. ${maxAmount.toLocaleString("es-BO")}).`;
      if (context.requestedAmount < minAmount) {
        amountMsg = `El monto solicitado es inferior al mínimo permitido para este producto (mínimo: Bs. ${minAmount.toLocaleString("es-BO")}).`;
      } else if (context.requestedAmount > maxAmount) {
        amountMsg = `El monto solicitado supera el límite máximo permitido para este producto (máximo: Bs. ${maxAmount.toLocaleString("es-BO")}).`;
      }
      reasons.push({
        code: "RULE_AMOUNT_RANGE",
        message: amountMsg,
        passed: amountPassed,
        status: amountPassed ? "PASSED" : "FAILED",
      });

      // 4. Debt to Income (DTI) Rule (CA-17.05, CA-17.13, PA-17.03, PA-17.04)
      const dtiThreshold =
        product.maxDebtToIncome !== null ? Number(product.maxDebtToIncome) : DEFAULT_MAX_DTI;
      if (context.profile.debtToIncome !== null) {
        const dti = context.profile.debtToIncome;
        const dtiPassed = dti <= dtiThreshold;
        reasons.push({
          code: "RULE_MAX_DTI",
          message: dtiPassed
            ? `Relación deuda/ingreso (${(dti * 100).toFixed(1)}%) dentro del límite admisible (máximo ${(dtiThreshold * 100).toFixed(0)}%).`
            : `Relación deuda/ingreso (${(dti * 100).toFixed(1)}%) excede el límite máximo admisible (${(dtiThreshold * 100).toFixed(0)}%).`,
          passed: dtiPassed,
          status: dtiPassed ? "PASSED" : "FAILED",
        });
      } else {
        // Missing DTI indicator: neither verified nor failed. Do not invent failure!
        reasons.push({
          code: "RULE_MAX_DTI_NOT_EVALUABLE",
          message:
            "No se pudo evaluar la relación deuda/ingreso porque la fuente bancaria no aportó información de ingresos. Esta condición no se asume cumplida ni incumplida.",
          passed: false,
          status: "NOT_EVALUABLE",
        });
      }

      // 5. Recent Arrears Rule (CA-17.05, CA-17.13, PA-17.03, PA-17.04)
      if (product.allowsRecentArrears) {
        reasons.push({
          code: "RULE_ARREARS",
          message: "El producto admite solicitantes con regularizaciones o mora previa.",
          passed: true,
          status: "PASSED",
        });
      } else if (context.profile.hasRecentArrears !== null) {
        const arrearsPassed = context.profile.hasRecentArrears === false;
        reasons.push({
          code: "RULE_ARREARS",
          message: arrearsPassed
            ? "Sin historial de atrasos o mora reciente."
            : "El solicitante presenta antecedentes de mora reciente no permitidos para este producto.",
          passed: arrearsPassed,
          status: arrearsPassed ? "PASSED" : "FAILED",
        });
      } else {
        // Missing arrears indicator
        reasons.push({
          code: "RULE_ARREARS_NOT_EVALUABLE",
          message:
            "No se pudo verificar el historial de mora debido a falta de información en las fuentes disponibles. La condición no se asume cumplida ni incumplida.",
          passed: false,
          status: "NOT_EVALUABLE",
        });
      }

      // 6. Disposable Income Rule (CA-17.05, CA-17.13, PA-17.03, PA-17.04)
      if (product.minMonthlyDisposableIncome !== null) {
        const minDisp = Number(product.minMonthlyDisposableIncome);
        if (context.profile.disposableIncome !== null) {
          const dispPassed = context.profile.disposableIncome >= minDisp;
          reasons.push({
            code: "RULE_MIN_DISPOSABLE_INCOME",
            message: dispPassed
              ? `Ingreso mensual disponible suficiente (Bs. ${context.profile.disposableIncome.toLocaleString("es-BO")}, mínimo requerido: Bs. ${minDisp.toLocaleString("es-BO")}).`
              : `Ingreso mensual disponible insuficiente frente al requerimiento mínimo de Bs. ${minDisp.toLocaleString("es-BO")}. (Disponible: Bs. ${context.profile.disposableIncome.toLocaleString("es-BO")}).`,
            passed: dispPassed,
            status: dispPassed ? "PASSED" : "FAILED",
          });
        } else {
          reasons.push({
            code: "RULE_MIN_DISPOSABLE_INCOME_NOT_EVALUABLE",
            message:
              "No se pudo comprobar la capacidad neta disponible por falta de datos de ingresos/egresos en las fuentes consultadas.",
            passed: false,
            status: "NOT_EVALUABLE",
          });
        }
      } else {
        if (context.profile.disposableIncome !== null) {
          const dispPassed = context.profile.disposableIncome > 0;
          reasons.push({
            code: "RULE_MIN_DISPOSABLE_INCOME",
            message: dispPassed
              ? `Ingreso mensual disponible positivo (Bs. ${context.profile.disposableIncome.toLocaleString("es-BO")}) para respaldar el crédito.`
              : "Capacidad neta o ingreso disponible mensual insuficiente.",
            passed: dispPassed,
            status: dispPassed ? "PASSED" : "FAILED",
          });
        } else {
          reasons.push({
            code: "RULE_MIN_DISPOSABLE_INCOME_NOT_EVALUABLE",
            message:
              "No se pudo comprobar la capacidad neta disponible por falta de datos de ingresos/egresos en las fuentes consultadas.",
            passed: false,
            status: "NOT_EVALUABLE",
          });
        }
      }

      // Outcome & Compatibility Status determination (CA-17.05, PA-17.03, PA-17.04)
      const hasVerifiedFailure = reasons.some((r) => r.status === "FAILED");
      const hasUnevaluable = reasons.some((r) => r.status === "NOT_EVALUABLE");

      let compatibilityStatus: "COMPATIBLE" | "INCOMPATIBLE" | "NOT_EVALUABLE";
      let outcome: "RECOMMENDED" | "NOT_COMPATIBLE" | "NOT_EVALUABLE";

      if (hasVerifiedFailure) {
        compatibilityStatus = "INCOMPATIBLE";
        outcome = "NOT_COMPATIBLE";
      } else if (hasUnevaluable) {
        compatibilityStatus = "NOT_EVALUABLE";
        outcome = "NOT_EVALUABLE";
      } else {
        compatibilityStatus = "COMPATIBLE";
        outcome = "RECOMMENDED";
      }

      // S4-HF-06: congelar el producto y sus reglas tal como se evaluaron.
      const productSnapshot = {
        name: product.name,
        category: product.category,
        applicantScope: product.applicantScope,
        minAmount,
        maxAmount,
        maxDebtToIncome: product.maxDebtToIncome !== null ? Number(product.maxDebtToIncome) : null,
        minMonthlyDisposableIncome:
          product.minMonthlyDisposableIncome !== null
            ? Number(product.minMonthlyDisposableIncome)
            : null,
        allowsRecentArrears: product.allowsRecentArrears,
        purposes: product.purposes.map((p) => p.purpose),
      };

      // Persist EvaluationRecommendation (DB enum: RECOMMENDED | NOT_COMPATIBLE)
      const dbOutcome = outcome === "RECOMMENDED" ? "RECOMMENDED" : "NOT_COMPATIBLE";
      const existingRec = await this.db.client.evaluationRecommendation.findFirst({
        where: { tenantId, evaluationId, productId: product.id },
      });
      const recId = existingRec?.id ?? randomUUID();

      const savedRec = await this.db.client.evaluationRecommendation.upsert({
        where: { id: recId },
        update: {
          outcome: dbOutcome,
          ruleVersion: RULE_VERSION,
          productSnapshot,
          evaluatedAt: new Date(),
        },
        create: {
          id: recId,
          tenantId,
          evaluationId,
          productId: product.id,
          outcome: dbOutcome,
          ruleVersion: RULE_VERSION,
          productSnapshot,
        },
      });

      // Persist RecommendationReasons
      await this.db.client.recommendationReason.deleteMany({
        where: { tenantId, recommendationId: savedRec.id },
      });
      await this.db.client.recommendationReason.createMany({
        data: reasons.map((r) => ({
          id: randomUUID(),
          tenantId,
          recommendationId: savedRec.id,
          code: r.code,
          message: r.message,
          passed: r.passed,
        })),
      });

      evaluatedResults.push({
        id: savedRec.id,
        productId: product.id,
        productName: product.name,
        category: product.category,
        outcome,
        compatibilityStatus,
        ruleVersion: RULE_VERSION,
        minAmount,
        maxAmount,
        evaluatedAt: savedRec.evaluatedAt,
        reasons,
      });
    }

    // CA-17.06: Priority / tie-breaking sorting:
    // 1. RECOMMENDED (COMPATIBLE)
    // 2. NOT_EVALUABLE
    // 3. NOT_COMPATIBLE (INCOMPATIBLE)
    evaluatedResults.sort((a, b) => {
      const outcomeRank = (item: ProductRecommendationDto) => {
        if (item.outcome === "RECOMMENDED" || item.compatibilityStatus === "COMPATIBLE") return 1;
        if (item.outcome === "NOT_EVALUABLE" || item.compatibilityStatus === "NOT_EVALUABLE") return 2;
        return 3;
      };
      const rankA = outcomeRank(a);
      const rankB = outcomeRank(b);
      if (rankA !== rankB) return rankA - rankB;

      const orderA = CATEGORY_ORDER[a.category] ?? 99;
      const orderB = CATEGORY_ORDER[b.category] ?? 99;
      if (orderA !== orderB) return orderA - orderB;

      return a.productName.localeCompare(b.productName);
    });

    return evaluatedResults;
  }
}
