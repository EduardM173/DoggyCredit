import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Test } from "@nestjs/testing";
import { AppModule } from "../dist/app.module.js";
import { PrismaService } from "../dist/infrastructure/prisma/prisma.service.js";
import { TenantPreparationService } from "../dist/identity-tenants/public.js";
import { BureauMockSource } from "../dist/financial-integrations/public.js";
import { ResilientSources } from "../dist/financial-integrations/resilience/resilient-sources.js";
import { FinancialProfileCalculator } from "../dist/financial-profile/public.js";
import { EvaluationRecommender } from "../dist/recommendations/public.js";
import { EvaluationsService } from "../dist/evaluations/evaluations.service.js";

describe("S4-OPS-01 PostgreSQL concurrency", () => {
  let apps = [];
  let db;
  let services;
  let bankHasData = true;

  before(async () => {
    const profile = {
      averageMonthlyIncome: 6000,
      averageMonthlyExpenses: 2500,
      disposableIncome: 3500,
      totalDebt: 0,
      activeCredits: 0,
      debtToIncome: 0,
      hasRecentArrears: false,
      completeness: 1,
      profileVersion: "ops-01-test",
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
    for (let index = 0; index < 2; index += 1) {
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
            status: bankHasData ? "SUCCESS" : "NO_DATA",
            providerId,
            ...(bankHasData
              ? {
                  data: {
                    documentNumber,
                    averageMonthlyIncome: 6000,
                    averageMonthlyExpenses: 2500,
                    totalDebt: 0,
                    activeCredits: 0,
                    hasRecentArrears: false,
                  },
                }
              : {}),
            externalReference: "ops-01-test",
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
      await app.init();
      apps.push(app);
    }
    db = apps[0].get(PrismaService);
    services = apps.map((app) => app.get(EvaluationsService));
  });

  after(async () => Promise.all(apps.map((app) => app.close())));

  function processEvaluationInParallel(context, evaluationId) {
    const worker = resolve(dirname(fileURLToPath(import.meta.url)), "ops-01-process-worker.mjs");
    const startAt = Date.now() + 3000;
    return Promise.all(
      [0, 1].map(
        () =>
          new Promise((resolveResult, reject) => {
            const child = spawn(process.execPath, [worker], {
              env: {
                ...process.env,
                OPS01_CONTEXT: JSON.stringify(context),
                OPS01_EVALUATION_ID: evaluationId,
                OPS01_START_AT: String(startAt),
              },
              stdio: ["ignore", "pipe", "pipe"],
            });
            let stdout = "";
            let stderr = "";
            child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
            child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
            child.once("error", reject);
            child.once("exit", (code) => {
              if (code !== 0) return reject(new Error(`Nest worker failed (${code}): ${stderr}`));
              try {
                resolveResult(JSON.parse(stdout.trim().split("\n").at(-1)).status);
              } catch (error) {
                reject(
                  new Error(`Nest worker returned invalid output: ${stdout} ${stderr}`, { cause: error }),
                );
              }
            });
          }),
      ),
    );
  }

  async function fixture() {
    const suffix = randomUUID().slice(0, 8);
    const user = await db.user.create({
      data: {
        email: `ops01-${suffix}@example.test`,
        fullName: "OPS 01 test",
        passwordHash: "not-used",
        status: "ACTIVE",
      },
    });
    const tenant = await db.tenant.create({
      data: {
        slug: `ops01-${suffix}`,
        legalName: "OPS 01 test",
        taxId: `OPS01-${suffix}`,
        institutionType: "BANK",
        status: "ACTIVE",
      },
    });
    const membership = await db.tenantMembership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "ANALYST", status: "ACTIVE" },
    });
    const plan = await db.plan.create({
      data: { code: `OPS01-${suffix}`, name: "OPS test", active: true },
    });
    await db.tenantSubscription.create({
      data: { tenantId: tenant.id, planId: plan.id, status: "ACTIVE" },
    });
    const bank = await db.integrationProvider.upsert({
      where: { code: "BANK_MOCK" },
      create: { code: "BANK_MOCK", name: "Banco simulado", kind: "BANK" },
      update: {},
    });
    const context = {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      membershipId: membership.id,
      userId: user.id,
      userName: user.fullName,
      role: "ANALYST",
    };
    return { context, bank };
  }

  it("isolates same keys by tenant and commits one usage record under concurrent processing", async () => {
    const x = await fixture();
    const y = await fixture();
    const key = `ops01-${randomUUID()}`;
    const payload = (number) => ({
      idempotencyKey: key,
      clientType: "PERSON",
      documentType: "CI",
      documentNumber: number,
      name: "Solicitante de prueba",
      purpose: "WORKING_CAPITAL",
      requestedAmount: 1000,
      consentGiven: true,
    });
    const [draftX, sameIntent, draftY] = await Promise.all([
      services[0].createDraft(x.context, payload("10000001")),
      services[1].createDraft(x.context, payload("10000001")),
      services[1].createDraft(y.context, payload("10000002")),
    ]);
    assert.equal(draftX.id, sameIntent.id);
    assert.notEqual(draftX.id, draftY.id);
    assert.equal(await db.evaluation.count({ where: { idempotencyKey: key } }), 2);

    const [statusA, statusB] = await processEvaluationInParallel(x.context, draftX.id);
    assert.ok(["IN_PROGRESS", "COMPLETED"].includes(statusA));
    assert.ok(["IN_PROGRESS", "COMPLETED"].includes(statusB));
    const final = await db.evaluation.findFirstOrThrow({
      where: { id: draftX.id, tenantId: x.context.tenantId },
    });
    assert.equal(final.status, "COMPLETED");
    assert.equal(
      await db.usageRecord.count({ where: { tenantId: x.context.tenantId, referenceId: draftX.id } }),
      1,
    );
    assert.equal(
      await db.usageRecord.count({ where: { tenantId: y.context.tenantId, referenceId: draftX.id } }),
      0,
    );
    assert.equal(
      await db.auditLog.count({
        where: { tenantId: x.context.tenantId, entityId: draftX.id, action: "EVALUATION_PROCESSED" },
      }),
      1,
    );
  });

  it("rejects a different payload under an already reserved tenant-scoped key", async () => {
    const { context } = await fixture();
    const key = `ops01-${randomUUID()}`;
    const payload = {
      idempotencyKey: key,
      clientType: "PERSON",
      documentType: "CI",
      documentNumber: "20000001",
      name: "Solicitante de prueba",
      purpose: "WORKING_CAPITAL",
      requestedAmount: 1000,
      consentGiven: true,
    };
    await services[0].createDraft(context, payload);
    await assert.rejects(
      services[1].createDraft(context, { ...payload, requestedAmount: 2000 }),
      (error) => error.status === 409,
    );
    assert.equal(
      await db.evaluation.count({ where: { tenantId: context.tenantId, idempotencyKey: key } }),
      1,
    );
  });

  it("retries the same INCOMPLETE evaluation and records usage only when it completes", async () => {
    const { context } = await fixture();
    const evaluation = await services[0].createDraft(context, {
      idempotencyKey: `ops01-${randomUUID()}`,
      clientType: "PERSON",
      documentType: "CI",
      documentNumber: "30000001",
      name: "Reintento incompleto",
      purpose: "WORKING_CAPITAL",
      requestedAmount: 1000,
      consentGiven: true,
    });

    bankHasData = false;
    const incomplete = await services[0].processEvaluation(context, evaluation.id);
    assert.equal(incomplete.status, "INCOMPLETE");
    assert.equal(await db.usageRecord.count({ where: { tenantId: context.tenantId } }), 0);

    bankHasData = true;
    const completed = await services[1].processEvaluation(context, evaluation.id);
    assert.equal(completed.status, "COMPLETED");
    assert.equal(await db.evaluation.count({ where: { tenantId: context.tenantId } }), 1);
    assert.equal(await db.usageRecord.count({ where: { tenantId: context.tenantId } }), 1);
  });
});
