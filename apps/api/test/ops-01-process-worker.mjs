import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import process from "node:process";
import { Test } from "@nestjs/testing";
import { AppModule } from "../dist/app.module.js";
import { TenantPreparationService } from "../dist/identity-tenants/public.js";
import { BureauMockSource } from "../dist/financial-integrations/public.js";
import { ResilientSources } from "../dist/financial-integrations/resilience/resilient-sources.js";
import { FinancialProfileCalculator } from "../dist/financial-profile/public.js";
import { EvaluationRecommender } from "../dist/recommendations/public.js";
import { EvaluationsService } from "../dist/evaluations/evaluations.service.js";

const profile = {
  averageMonthlyIncome: 6000,
  averageMonthlyExpenses: 2500,
  disposableIncome: 3500,
  totalDebt: 0,
  activeCredits: 0,
  debtToIncome: 0,
  hasRecentArrears: false,
  completeness: 1,
  profileVersion: "ops-01-process-test",
};
const provenance = Object.fromEntries(
  [
    "averageMonthlyIncome",
    "averageMonthlyExpenses",
    "disposableIncome",
    "totalDebt",
    "activeCredits",
    "debtToIncome",
    "hasRecentArrears",
  ].map((key) => [key, "BANK_MOCK"]),
);

const module = await Test.createTestingModule({ imports: [AppModule] })
  .overrideProvider(TenantPreparationService)
  .useValue({
    read: async () => ({
      ready: true,
      completed: 3,
      percentage: 100,
      steps: { source: true, products: true },
      source: { enabled: true },
      products: [{ selected: true, applicantScope: "PERSON" }],
      tenant: { name: "OPS test" },
    }),
  })
  .overrideProvider(BureauMockSource)
  .useValue({ status: async () => ({ enabled: false, available: false }) })
  .overrideProvider(ResilientSources)
  .useValue({
    queryBank: async (providerId, _tenantId, documentNumber) => ({
      status: "SUCCESS",
      providerId,
      data: {
        documentNumber,
        averageMonthlyIncome: 6000,
        averageMonthlyExpenses: 2500,
        totalDebt: 0,
        activeCredits: 0,
        hasRecentArrears: false,
      },
      externalReference: "ops-01-process-test",
    }),
  })
  .overrideProvider(FinancialProfileCalculator)
  .useValue({
    consolidate: () => ({ indicators: profile, provenance }),
    saveProfile: async (tenantId, evaluationId) => ({
      id: randomUUID(),
      tenantId,
      evaluationId,
      ...profile,
      calculatedAt: new Date(),
    }),
  })
  .overrideProvider(EvaluationRecommender)
  .useValue({ evaluate: async () => [] })
  .compile();

const app = module.createNestApplication({ logger: false });
try {
  await app.init();
  const startAt = Number(process.env.OPS01_START_AT);
  await delay(Math.max(0, startAt - Date.now()));
  const result = await app
    .get(EvaluationsService)
    .processEvaluation(JSON.parse(process.env.OPS01_CONTEXT), process.env.OPS01_EVALUATION_ID);
  process.stdout.write(`${JSON.stringify({ status: result.status })}\n`);
} finally {
  await app.close();
}
