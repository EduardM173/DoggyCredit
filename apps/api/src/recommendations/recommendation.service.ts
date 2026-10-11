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

  async evaluate(
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

      // 1. Applicant Scope Rule
      const scopePassed =
        product.applicantScope === "BOTH" || product.applicantScope === context.applicantScope;
      reasons.push({
        code: "RULE_APPLICANT_SCOPE",
        message: scopePassed
          ? "Tipo de solicitante compatible con el producto."
          : "El producto está destinado exclusivamente a empresas o personas jurídicas.",
        passed: scopePassed,
      });

      // 2. Credit Purpose Rule
      const purposePassed = product.purposes.some((p) => p.purpose === context.purpose);
      reasons.push({
        code: "RULE_PURPOSE",
        message: purposePassed
          ? "Finalidad del crédito admitida para este producto."
          : "La finalidad solicitada no se encuentra contemplada en este producto.",
        passed: purposePassed,
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
      });

      // 4. Debt to Income (DTI) Rule
      const dtiThreshold =
        product.maxDebtToIncome !== null ? Number(product.maxDebtToIncome) : DEFAULT_MAX_DTI;
      let dtiPassed = false;
      let dtiMsg = "No se dispone de información suficiente de ingresos para validar la relación deuda/ingreso.";
      if (context.profile.debtToIncome !== null) {
        const dti = context.profile.debtToIncome;
        dtiPassed = dti <= dtiThreshold;
        dtiMsg = dtiPassed
          ? `Relación deuda/ingreso (${(dti * 100).toFixed(1)}%) dentro del límite admisible (máximo ${(dtiThreshold * 100).toFixed(0)}%).`
          : `Relación deuda/ingreso (${(dti * 100).toFixed(1)}%) excede el límite máximo admisible (${(dtiThreshold * 100).toFixed(0)}%).`;
      }
      reasons.push({
        code: "RULE_MAX_DTI",
        message: dtiMsg,
        passed: dtiPassed,
      });

      // 5. Recent Arrears Rule
      let arrearsPassed: boolean;
      let arrearsMsg: string;
      if (!product.allowsRecentArrears) {
        if (context.profile.hasRecentArrears === false) {
          arrearsPassed = true;
          arrearsMsg = "Sin historial de atrasos o mora reciente.";
        } else {
          arrearsPassed = false;
          arrearsMsg =
            "El solicitante presenta antecedentes de mora reciente no permitidos para este producto.";
        }
      } else {
        arrearsPassed = true;
        arrearsMsg = "El producto admite solicitantes con regularizaciones o mora previa.";
      }
      reasons.push({
        code: "RULE_ARREARS",
        message: arrearsMsg,
        passed: arrearsPassed,
      });

      // 6. Disposable Income Rule
      let dispPassed: boolean;
      let dispMsg: string;
      if (product.minMonthlyDisposableIncome !== null) {
        const minDisp = Number(product.minMonthlyDisposableIncome);
        if (
          context.profile.disposableIncome !== null &&
          context.profile.disposableIncome >= minDisp
        ) {
          dispPassed = true;
          dispMsg = `Ingreso mensual disponible suficiente (Bs. ${context.profile.disposableIncome.toLocaleString("es-BO")}, mínimo requerido: Bs. ${minDisp.toLocaleString("es-BO")}).`;
        } else {
          dispPassed = false;
          dispMsg = `Ingreso mensual disponible insuficiente frente al requerimiento mínimo de Bs. ${minDisp.toLocaleString("es-BO")}.`;
        }
      } else {
        if (
          context.profile.disposableIncome !== null &&
          context.profile.disposableIncome > 0
        ) {
          dispPassed = true;
          dispMsg = `Ingreso mensual disponible positivo (Bs. ${context.profile.disposableIncome.toLocaleString("es-BO")}) para respaldar el crédito.`;
        } else {
          dispPassed = false;
          dispMsg = "Capacidad neta o ingreso disponible mensual insuficiente.";
        }
      }
      reasons.push({
        code: "RULE_MIN_DISPOSABLE_INCOME",
        message: dispMsg,
        passed: dispPassed,
      });

      const outcome = reasons.every((r) => r.passed) ? "RECOMMENDED" : "NOT_COMPATIBLE";

      // Persist EvaluationRecommendation
      const existingRec = await this.db.client.evaluationRecommendation.findFirst({
        where: { tenantId, evaluationId, productId: product.id },
      });
      const recId = existingRec?.id ?? randomUUID();

      const savedRec = await this.db.client.evaluationRecommendation.upsert({
        where: { id: recId },
        update: {
          outcome,
          ruleVersion: RULE_VERSION,
          evaluatedAt: new Date(),
        },
        create: {
          id: recId,
          tenantId,
          evaluationId,
          productId: product.id,
          outcome,
          ruleVersion: RULE_VERSION,
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
        ruleVersion: RULE_VERSION,
        minAmount,
        maxAmount,
        evaluatedAt: savedRec.evaluatedAt,
        reasons,
      });
    }

    // CA-12.08: Priority / tie-breaking sorting
    evaluatedResults.sort((a, b) => {
      if (a.outcome !== b.outcome) {
        return a.outcome === "RECOMMENDED" ? -1 : 1;
      }
      const orderA = CATEGORY_ORDER[a.category] ?? 99;
      const orderB = CATEGORY_ORDER[b.category] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      return a.productName.localeCompare(b.productName);
    });

    return evaluatedResults;
  }
}
