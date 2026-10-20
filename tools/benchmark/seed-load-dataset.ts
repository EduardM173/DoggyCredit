import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  CreditPurpose,
  EvaluationStatus,
  InstitutionType,
  IntegrationKind,
  IntegrationStatus,
  PlatformRole,
  PrismaClient,
  RecommendationOutcome,
  SourceResultStatus,
  TenantRole,
  UsageMetric,
  UserStatus,
} from "../../apps/api/src/generated/prisma/client.js";
import { hashPassword } from "../../apps/api/src/identity-tenants/auth/password-hashing.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed the load dataset.");
}

const pool = new Pool({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

export const BENCHMARK_TOKENS = {
  anaSol: "ana_sol_load_test_session_token_12345678901",
  carlosSol: "carlos_sol_load_test_session_token_12345678",
  adminLuna: "admin_luna_load_test_session_token_12345678",
  analistaLuna: "analista_luna_load_test_session_token_12345",
  operador: "operador_demo_doggycredit_load_test_token12",
};

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

export async function seedLoadDataset() {
  console.log("==> Seeding S4-OPS-06 Load Dataset for Multi-Tenant Benchmark...");

  // 1. Providers
  const bankProvider = await prisma.integrationProvider.upsert({
    where: { code: "BANK_MOCK" },
    update: { status: IntegrationStatus.ACTIVE },
    create: { code: "BANK_MOCK", name: "Bank Mock", kind: IntegrationKind.BANK, status: IntegrationStatus.ACTIVE },
  });

  const bureauProvider = await prisma.integrationProvider.upsert({
    where: { code: "BUREAU_MOCK" },
    update: { status: IntegrationStatus.ACTIVE },
    create: {
      code: "BUREAU_MOCK",
      name: "Buró Crediticio Simulado",
      kind: IntegrationKind.CREDIT_BUREAU,
      status: IntegrationStatus.ACTIVE,
    },
  });

  // 2. Plans
  const plans = [
    {
      code: "BASIC",
      name: "Básico",
      displayOrder: 1,
      price: 0,
      evaluationsPerMonth: 50,
      maxUsers: 3,
      requiresPayment: false,
    },
    {
      code: "PROFESSIONAL",
      name: "Profesional",
      displayOrder: 2,
      price: 349,
      evaluationsPerMonth: 500,
      maxUsers: 15,
      requiresPayment: true,
    },
    {
      code: "ENTERPRISE",
      name: "Empresarial",
      displayOrder: 3,
      price: 799,
      evaluationsPerMonth: null, // Unlimited
      maxUsers: null,
      requiresPayment: true,
    },
  ];

  const planMap: Record<string, string> = {};
  for (const p of plans) {
    const plan = await prisma.plan.upsert({
      where: { code: p.code },
      update: { isPublic: true, displayOrder: p.displayOrder, evaluationsPerMonth: p.evaluationsPerMonth },
      create: {
        code: p.code,
        name: p.name,
        displayOrder: p.displayOrder,
        price: p.price,
        currency: "BOB",
        billingPeriod: "MONTHLY",
        evaluationsPerMonth: p.evaluationsPerMonth,
        maxUsers: p.maxUsers,
        isPublic: true,
        requiresPayment: p.requiresPayment,
        scoringEnabled: true,
      },
    });
    planMap[p.code] = plan.id;
  }

  // 3. Platform Operator
  const operatorPasswordHash = await hashPassword("DoggyDemo2026!");
  const operatorUser = await prisma.user.upsert({
    where: { email: "operador.demo@doggycredit.local" },
    update: { platformRole: PlatformRole.OPERATOR, status: UserStatus.ACTIVE },
    create: {
      email: "operador.demo@doggycredit.local",
      fullName: "Operador Demo DoggyCredit",
      passwordHash: operatorPasswordHash,
      platformRole: PlatformRole.OPERATOR,
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date("2026-10-01T00:00:00Z"),
    },
  });

  // Operator session
  await prisma.adminSession.upsert({
    where: { tokenHash: digest(BENCHMARK_TOKENS.operador) },
    update: { expiresAt: new Date(Date.now() + 86400000 * 30), revokedAt: null },
    create: {
      userId: operatorUser.id,
      tokenHash: digest(BENCHMARK_TOKENS.operador),
      expiresAt: new Date(Date.now() + 86400000 * 30),
    },
  });

  // Platform Audit
  await prisma.auditLog.createMany({
    data: [
      {
        actorUserId: operatorUser.id,
        action: "TENANT_REVIEWED",
        entityType: "TENANT",
        entityId: "platform",
        metadata: { note: "Benchmark initial status check" },
        createdAt: new Date("2026-10-15T10:00:00Z"),
      },
    ],
    skipDuplicates: true,
  });

  // 4. Tenant A: Banco del Sol Demo (High Volume)
  const tenantA = await prisma.tenant.upsert({
    where: { slug: "banco-del-sol-demo" },
    update: { status: "ACTIVE" },
    create: {
      slug: "banco-del-sol-demo",
      legalName: "Banco del Sol Demo S.A.",
      taxId: "NIT-1029384756",
      institutionType: InstitutionType.BANK,
      status: "ACTIVE",
      informationConfirmedAt: new Date("2026-10-01T12:00:00Z"),
      productsConfirmedAt: new Date("2026-10-01T12:00:00Z"),
    },
  });

  // Tenant A Subscription
  await prisma.tenantSubscription.upsert({
    where: { id: "00000000-0000-0000-0000-00000000000a" },
    update: { status: "ACTIVE", planId: planMap["PROFESSIONAL"] },
    create: {
      id: "00000000-0000-0000-0000-00000000000a",
      tenantId: tenantA.id,
      planId: planMap["PROFESSIONAL"],
      status: "ACTIVE",
      startsAt: new Date("2026-09-01T00:00:00Z"),
    },
  });

  // Tenant A Integrations
  for (const prov of [bankProvider, bureauProvider]) {
    await prisma.tenantIntegration.upsert({
      where: { tenantId_providerId: { tenantId: tenantA.id, providerId: prov.id } },
      update: { enabled: true, status: IntegrationStatus.ACTIVE },
      create: { tenantId: tenantA.id, providerId: prov.id, enabled: true, status: IntegrationStatus.ACTIVE },
    });
  }

  // Tenant A Users: Ana & Carlos
  const anaUser = await prisma.user.upsert({
    where: { email: "ana.hu10@doggycredit.local" },
    update: { status: UserStatus.ACTIVE },
    create: {
      email: "ana.hu10@doggycredit.local",
      fullName: "Ana López Directora",
      passwordHash: await hashPassword("DoggyInstitucion2026!"),
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date("2026-10-01T00:00:00Z"),
    },
  });

  const carlosUser = await prisma.user.upsert({
    where: { email: "carlos.hu10@doggycredit.local" },
    update: { status: UserStatus.ACTIVE },
    create: {
      email: "carlos.hu10@doggycredit.local",
      fullName: "Carlos Pérez Analista",
      passwordHash: await hashPassword("DoggyAnalista2026!"),
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date("2026-10-01T00:00:00Z"),
    },
  });

  const anaMembershipA = await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: tenantA.id, userId: anaUser.id } },
    update: { status: "ACTIVE", role: TenantRole.INSTITUTION_ADMIN },
    create: { tenantId: tenantA.id, userId: anaUser.id, role: TenantRole.INSTITUTION_ADMIN, status: "ACTIVE" },
  });

  const carlosMembershipA = await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: tenantA.id, userId: carlosUser.id } },
    update: { status: "ACTIVE", role: TenantRole.ANALYST },
    create: { tenantId: tenantA.id, userId: carlosUser.id, role: TenantRole.ANALYST, status: "ACTIVE" },
  });

  // Sessions for Ana & Carlos
  await prisma.institutionSession.upsert({
    where: { tokenHash: digest(BENCHMARK_TOKENS.anaSol) },
    update: { expiresAt: new Date(Date.now() + 86400000 * 30), revokedAt: null },
    create: {
      userId: anaUser.id,
      tokenHash: digest(BENCHMARK_TOKENS.anaSol),
      expiresAt: new Date(Date.now() + 86400000 * 30),
    },
  });

  await prisma.institutionSession.upsert({
    where: { tokenHash: digest(BENCHMARK_TOKENS.carlosSol) },
    update: { expiresAt: new Date(Date.now() + 86400000 * 30), revokedAt: null },
    create: {
      userId: carlosUser.id,
      tokenHash: digest(BENCHMARK_TOKENS.carlosSol),
      expiresAt: new Date(Date.now() + 86400000 * 30),
    },
  });

  // Financial Products for Tenant A
  const productA1 = await prisma.financialProduct.upsert({
    where: { tenantId_name: { tenantId: tenantA.id, name: "Crédito de Consumo Sol" } },
    update: { active: true },
    create: {
      tenantId: tenantA.id,
      name: "Crédito de Consumo Sol",
      category: "OTHER",
      applicantScope: "PERSON",
      minAmount: 5000,
      maxAmount: 100000,
      active: true,
      purposes: { create: [{ purpose: "WORKING_CAPITAL" }, { purpose: "OTHER" }] },
    },
  });

  // 5. Tenant B: Banco Luna Demo (Base Volume / Isolation Target)
  const tenantB = await prisma.tenant.upsert({
    where: { slug: "banco-luna-demo" },
    update: { status: "ACTIVE" },
    create: {
      slug: "banco-luna-demo",
      legalName: "Banco Luna Cooperativa",
      taxId: "NIT-9876543210",
      institutionType: InstitutionType.COOPERATIVE,
      status: "ACTIVE",
      informationConfirmedAt: new Date("2026-10-01T12:00:00Z"),
      productsConfirmedAt: new Date("2026-10-01T12:00:00Z"),
    },
  });

  await prisma.tenantSubscription.upsert({
    where: { id: "00000000-0000-0000-0000-00000000000b" },
    update: { status: "ACTIVE", planId: planMap["BASIC"] },
    create: {
      id: "00000000-0000-0000-0000-00000000000b",
      tenantId: tenantB.id,
      planId: planMap["BASIC"],
      status: "ACTIVE",
      startsAt: new Date("2026-09-01T00:00:00Z"),
    },
  });

  for (const prov of [bankProvider, bureauProvider]) {
    await prisma.tenantIntegration.upsert({
      where: { tenantId_providerId: { tenantId: tenantB.id, providerId: prov.id } },
      update: { enabled: true, status: IntegrationStatus.ACTIVE },
      create: { tenantId: tenantB.id, providerId: prov.id, enabled: true, status: IntegrationStatus.ACTIVE },
    });
  }

  const adminLunaUser = await prisma.user.upsert({
    where: { email: "admin.luna.hu10@doggycredit.local" },
    update: { status: UserStatus.ACTIVE },
    create: {
      email: "admin.luna.hu10@doggycredit.local",
      fullName: "Laura Méndez Admin Luna",
      passwordHash: await hashPassword("DoggyInstitucion2026!"),
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date("2026-10-01T00:00:00Z"),
    },
  });

  const analistaLunaUser = await prisma.user.upsert({
    where: { email: "analista.luna.hu10@doggycredit.local" },
    update: { status: UserStatus.ACTIVE },
    create: {
      email: "analista.luna.hu10@doggycredit.local",
      fullName: "Marcos Analyst Luna",
      passwordHash: await hashPassword("DoggyAnalista2026!"),
      status: UserStatus.ACTIVE,
      emailVerifiedAt: new Date("2026-10-01T00:00:00Z"),
    },
  });

  await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: tenantB.id, userId: adminLunaUser.id } },
    update: { status: "ACTIVE", role: TenantRole.INSTITUTION_ADMIN },
    create: { tenantId: tenantB.id, userId: adminLunaUser.id, role: TenantRole.INSTITUTION_ADMIN, status: "ACTIVE" },
  });

  const analistaMembershipB = await prisma.tenantMembership.upsert({
    where: { tenantId_userId: { tenantId: tenantB.id, userId: analistaLunaUser.id } },
    update: { status: "ACTIVE", role: TenantRole.ANALYST },
    create: { tenantId: tenantB.id, userId: analistaLunaUser.id, role: TenantRole.ANALYST, status: "ACTIVE" },
  });

  await prisma.institutionSession.upsert({
    where: { tokenHash: digest(BENCHMARK_TOKENS.adminLuna) },
    update: { expiresAt: new Date(Date.now() + 86400000 * 30), revokedAt: null },
    create: {
      userId: adminLunaUser.id,
      tokenHash: digest(BENCHMARK_TOKENS.adminLuna),
      expiresAt: new Date(Date.now() + 86400000 * 30),
    },
  });

  await prisma.institutionSession.upsert({
    where: { tokenHash: digest(BENCHMARK_TOKENS.analistaLuna) },
    update: { expiresAt: new Date(Date.now() + 86400000 * 30), revokedAt: null },
    create: {
      userId: analistaLunaUser.id,
      tokenHash: digest(BENCHMARK_TOKENS.analistaLuna),
      expiresAt: new Date(Date.now() + 86400000 * 30),
    },
  });

  const productB1 = await prisma.financialProduct.upsert({
    where: { tenantId_name: { tenantId: tenantB.id, name: "Microcrédito Luna" } },
    update: { active: true },
    create: {
      tenantId: tenantB.id,
      name: "Microcrédito Luna",
      category: "MICRO_CREDIT",
      applicantScope: "PERSON",
      minAmount: 1000,
      maxAmount: 20000,
      active: true,
      purposes: { create: [{ purpose: "WORKING_CAPITAL" }] },
    },
  });

  // 6. Clients Generation
  console.log("==> Creating Clients for Tenant A and Tenant B (including Duplicate CI 7812456 for Isolation)...");
  
  // Shared CI 7812456
  const clientA_Shared = await prisma.client.upsert({
    where: { tenantId_documentType_documentNumber: { tenantId: tenantA.id, documentType: "CI", documentNumber: "7812456" } },
    update: { name: "María Fernanda Rojas" },
    create: {
      tenantId: tenantA.id,
      type: "PERSON",
      documentType: "CI",
      documentNumber: "7812456",
      firstName: "María Fernanda",
      lastName: "Rojas",
      name: "María Fernanda Rojas",
      birthDate: new Date("1994-05-12"),
      phone: "71234567",
    },
  });

  const clientB_Shared = await prisma.client.upsert({
    where: { tenantId_documentType_documentNumber: { tenantId: tenantB.id, documentType: "CI", documentNumber: "7812456" } },
    update: { name: "Juan Carlos Luna" },
    create: {
      tenantId: tenantB.id,
      type: "PERSON",
      documentType: "CI",
      documentNumber: "7812456",
      firstName: "Juan Carlos",
      lastName: "Luna",
      name: "Juan Carlos Luna",
      birthDate: new Date("1988-11-20"),
      phone: "79876543",
    },
  });

  // Generate 120 clients for Tenant A
  const clientsA: string[] = [clientA_Shared.id];
  for (let i = 1; i < 120; i++) {
    const doc = `7812${String(456 + i).padStart(4, "0")}`;
    const cl = await prisma.client.upsert({
      where: { tenantId_documentType_documentNumber: { tenantId: tenantA.id, documentType: "CI", documentNumber: doc } },
      update: {},
      create: {
        tenantId: tenantA.id,
        type: "PERSON",
        documentType: "CI",
        documentNumber: doc,
        firstName: `ClienteA_${i}`,
        lastName: `Sol_${i}`,
        name: `ClienteA_${i} Sol_${i}`,
        birthDate: new Date("1992-01-01"),
        phone: `7100${String(i).padStart(4, "0")}`,
      },
    });
    clientsA.push(cl.id);
  }

  // Generate 25 clients for Tenant B
  const clientsB: string[] = [clientB_Shared.id];
  for (let i = 1; i < 25; i++) {
    const doc = `8899${String(100 + i).padStart(4, "0")}`;
    const cl = await prisma.client.upsert({
      where: { tenantId_documentType_documentNumber: { tenantId: tenantB.id, documentType: "CI", documentNumber: doc } },
      update: {},
      create: {
        tenantId: tenantB.id,
        type: "PERSON",
        documentType: "CI",
        documentNumber: doc,
        firstName: `ClienteB_${i}`,
        lastName: `Luna_${i}`,
        name: `ClienteB_${i} Luna_${i}`,
        birthDate: new Date("1995-02-02"),
        phone: `7200${String(i).padStart(4, "0")}`,
      },
    });
    clientsB.push(cl.id);
  }

  // 7. Evaluations Generation
  console.log("==> Seeding 500 Evaluations for Tenant A (Banco del Sol)...");
  const now = Date.now();
  const dayMs = 86400000;

  // Check existing count in Tenant A
  const existingCountA = await prisma.evaluation.count({ where: { tenantId: tenantA.id } });
  if (existingCountA < 500) {
    const toCreate = 500 - existingCountA;
    console.log(`Creating ${toCreate} evaluations for Tenant A...`);

    for (let i = existingCountA; i < 500; i++) {
      const clientId = clientsA[i % clientsA.length];
      const ageDays = (i % 60); // Spread across 60 days
      const createdAt = new Date(now - ageDays * dayMs - (i * 123456) % dayMs);

      let status: EvaluationStatus = EvaluationStatus.COMPLETED;
      if (i % 10 === 0) status = EvaluationStatus.DRAFT;
      else if (i % 10 === 1) status = EvaluationStatus.INCOMPLETE;
      else if (i % 15 === 2) status = EvaluationStatus.FAILED;

      const requestedAmount = 10000 + (i * 500) % 50000;
      const idempotencyKey = `bench-eval-a-${i}-${Date.now()}`;

      const ev = await prisma.evaluation.create({
        data: {
          tenantId: tenantA.id,
          clientId,
          createdByMembershipId: i % 4 === 0 ? anaMembershipA.id : carlosMembershipA.id,
          idempotencyKey,
          purpose: CreditPurpose.WORKING_CAPITAL,
          requestedAmount,
          status,
          consentGivenAt: status !== EvaluationStatus.DRAFT ? createdAt : null,
          startedAt: status !== EvaluationStatus.DRAFT ? createdAt : null,
          completedAt: status === EvaluationStatus.COMPLETED ? new Date(createdAt.getTime() + 45000) : null,
          failureCode: status === EvaluationStatus.FAILED ? "PROVIDER_ERROR" : null,
          failureMessage: status === EvaluationStatus.FAILED ? "Provider simulation failed" : null,
          ruleVersion: "1.0.0",
          applicantSnapshot: {
            fullName: `Evaluated Applicant ${i}`,
            documentNumber: `7812${i}`,
            monthlyIncome: 12000,
          },
          createdAt,
          updatedAt: createdAt,
        },
      });

      // If COMPLETED, add profile, recommendations and source results
      if (status === EvaluationStatus.COMPLETED) {
        await prisma.financialProfile.create({
          data: {
            tenantId: tenantA.id,
            evaluationId: ev.id,
            averageMonthlyIncome: 12000,
            averageMonthlyExpenses: 5000,
            disposableIncome: 7000,
            totalDebt: 15000,
            activeCredits: 1,
            debtToIncome: 0.25,
            hasRecentArrears: false,
            completeness: 1.0,
            profileVersion: "1.0.0",
            calculatedAt: createdAt,
          },
        });

        const recOutcome = i % 5 === 0 ? RecommendationOutcome.NOT_COMPATIBLE : RecommendationOutcome.RECOMMENDED;
        const rec = await prisma.evaluationRecommendation.create({
          data: {
            tenantId: tenantA.id,
            evaluationId: ev.id,
            productId: productA1.id,
            outcome: recOutcome,
            ruleVersion: "1.0.0",
            productSnapshot: { name: productA1.name },
            evaluatedAt: createdAt,
          },
        });

        await prisma.recommendationReason.create({
          data: {
            tenantId: tenantA.id,
            recommendationId: rec.id,
            code: recOutcome === RecommendationOutcome.RECOMMENDED ? "DTI_OPTIMAL" : "DTI_EXCEEDED",
            message: recOutcome === RecommendationOutcome.RECOMMENDED ? "Capacidad de pago suficiente" : "Endeudamiento alto",
            passed: recOutcome === RecommendationOutcome.RECOMMENDED,
          },
        });

        await prisma.evaluationSourceResult.create({
          data: {
            tenantId: tenantA.id,
            evaluationId: ev.id,
            providerId: bankProvider.id,
            status: SourceResultStatus.SUCCESS,
            requestedAt: createdAt,
          },
        });
      }
    }
  }

  // 8. Evaluations for Tenant B (50 evaluations)
  console.log("==> Seeding 50 Evaluations for Tenant B (Banco Luna)...");
  const existingCountB = await prisma.evaluation.count({ where: { tenantId: tenantB.id } });
  if (existingCountB < 50) {
    for (let i = existingCountB; i < 50; i++) {
      const clientId = clientsB[i % clientsB.length];
      const ageDays = (i % 30);
      const createdAt = new Date(now - ageDays * dayMs - (i * 200000) % dayMs);

      const status = i % 8 === 0 ? EvaluationStatus.DRAFT : EvaluationStatus.COMPLETED;
      const ev = await prisma.evaluation.create({
        data: {
          tenantId: tenantB.id,
          clientId,
          createdByMembershipId: analistaMembershipB.id,
          idempotencyKey: `bench-eval-b-${i}-${Date.now()}`,
          purpose: CreditPurpose.WORKING_CAPITAL,
          requestedAmount: 5000,
          status,
          consentGivenAt: createdAt,
          startedAt: createdAt,
          completedAt: status === EvaluationStatus.COMPLETED ? new Date(createdAt.getTime() + 30000) : null,
          ruleVersion: "1.0.0",
          applicantSnapshot: { fullName: `Luna Applicant ${i}` },
          createdAt,
          updatedAt: createdAt,
        },
      });

      if (status === EvaluationStatus.COMPLETED) {
        await prisma.financialProfile.create({
          data: {
            tenantId: tenantB.id,
            evaluationId: ev.id,
            averageMonthlyIncome: 8000,
            averageMonthlyExpenses: 4000,
            disposableIncome: 4000,
            completeness: 1.0,
            profileVersion: "1.0.0",
            calculatedAt: createdAt,
          },
        });

        await prisma.evaluationRecommendation.create({
          data: {
            tenantId: tenantB.id,
            evaluationId: ev.id,
            productId: productB1.id,
            outcome: RecommendationOutcome.RECOMMENDED,
            ruleVersion: "1.0.0",
            evaluatedAt: createdAt,
          },
        });
      }
    }
  }

  // 9. Usage Records (1,200 for Tenant A, 100 for Tenant B)
  console.log("==> Seeding Usage Records (1,200 for Tenant A, 100 for Tenant B)...");
  const usageCountA = await prisma.usageRecord.count({ where: { tenantId: tenantA.id } });
  if (usageCountA < 1200) {
    const batchData = [];
    for (let i = usageCountA; i < 1200; i++) {
      const ageDays = i % 45;
      const occurredAt = new Date(now - ageDays * dayMs);
      batchData.push({
        tenantId: tenantA.id,
        metric: UsageMetric.EVALUATION,
        quantity: 1,
        referenceType: "EVALUATION",
        referenceId: `eval-ref-a-${i}`,
        idempotencyKey: `usage-a-${i}-${now}`,
        occurredAt,
      });
    }
    await prisma.usageRecord.createMany({ data: batchData, skipDuplicates: true });
  }

  const usageCountB = await prisma.usageRecord.count({ where: { tenantId: tenantB.id } });
  if (usageCountB < 100) {
    const batchData = [];
    for (let i = usageCountB; i < 100; i++) {
      const ageDays = i % 30;
      batchData.push({
        tenantId: tenantB.id,
        metric: UsageMetric.EVALUATION,
        quantity: 1,
        referenceType: "EVALUATION",
        referenceId: `eval-ref-b-${i}`,
        idempotencyKey: `usage-b-${i}-${now}`,
        occurredAt: new Date(now - ageDays * dayMs),
      });
    }
    await prisma.usageRecord.createMany({ data: batchData, skipDuplicates: true });
  }

  // 10. Audit Logs (500 for Tenant A, 50 for Tenant B)
  console.log("==> Seeding Audit Logs (500 for Tenant A, 50 for Tenant B)...");
  const auditCountA = await prisma.auditLog.count({ where: { tenantId: tenantA.id } });
  if (auditCountA < 500) {
    const batchData = [];
    for (let i = auditCountA; i < 500; i++) {
      const ageDays = i % 60;
      batchData.push({
        tenantId: tenantA.id,
        actorUserId: i % 2 === 0 ? anaUser.id : carlosUser.id,
        action: i % 3 === 0 ? "EVALUATION_CREATED" : i % 3 === 1 ? "EVALUATION_COMPLETED" : "CONFIG_CHANGED",
        entityType: "EVALUATION",
        entityId: `eval-audit-a-${i}`,
        metadata: { batchIndex: i },
        createdAt: new Date(now - ageDays * dayMs),
      });
    }
    await prisma.auditLog.createMany({ data: batchData, skipDuplicates: true });
  }

  const auditCountB = await prisma.auditLog.count({ where: { tenantId: tenantB.id } });
  if (auditCountB < 50) {
    const batchData = [];
    for (let i = auditCountB; i < 50; i++) {
      const ageDays = i % 30;
      batchData.push({
        tenantId: tenantB.id,
        actorUserId: analistaLunaUser.id,
        action: "EVALUATION_CREATED",
        entityType: "EVALUATION",
        entityId: `eval-audit-b-${i}`,
        metadata: { batchIndex: i },
        createdAt: new Date(now - ageDays * dayMs),
      });
    }
    await prisma.auditLog.createMany({ data: batchData, skipDuplicates: true });
  }

  console.log("==> Dataset Seeding Complete!");
  console.log(`Tenant A (banco-del-sol-demo):`);
  console.log(` - Evaluations: ${await prisma.evaluation.count({ where: { tenantId: tenantA.id } })}`);
  console.log(` - Clients: ${await prisma.client.count({ where: { tenantId: tenantA.id } })}`);
  console.log(` - UsageRecords: ${await prisma.usageRecord.count({ where: { tenantId: tenantA.id } })}`);
  console.log(` - AuditLogs: ${await prisma.auditLog.count({ where: { tenantId: tenantA.id } })}`);
  console.log(`Tenant B (banco-luna-demo):`);
  console.log(` - Evaluations: ${await prisma.evaluation.count({ where: { tenantId: tenantB.id } })}`);
  console.log(` - Clients: ${await prisma.client.count({ where: { tenantId: tenantB.id } })}`);
  console.log(` - UsageRecords: ${await prisma.usageRecord.count({ where: { tenantId: tenantB.id } })}`);
  console.log(` - AuditLogs: ${await prisma.auditLog.count({ where: { tenantId: tenantB.id } })}`);
  console.log(`Operator Users: ${await prisma.user.count({ where: { platformRole: PlatformRole.OPERATOR } })}`);
}

if (process.argv[1]?.endsWith("seed-load-dataset.ts")) {
  seedLoadDataset()
    .then(() => pool.end())
    .catch((err) => {
      console.error("Seeding failed:", err);
      process.exit(1);
    });
}
