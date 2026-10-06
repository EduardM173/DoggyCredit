import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PlatformRole, PrismaClient, UserStatus } from "../apps/api/src/generated/prisma/client.js";
import { hashPassword, verifyPassword } from "../apps/api/src/identity-tenants/auth/password-hashing.js";
import { demoProducts } from "../apps/api/src/recommendations/demo-products.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed the database.");
}

const pool = new Pool({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  if (
    [
      process.env.SEED_DEMO_PLANS,
      process.env.SEED_DEMO_OPERATOR,
      process.env.SEED_DEMO_BACKOFFICE_USERS,
      process.env.SEED_DEMO_PRODUCTS,
      process.env.SEED_DEMO_EVALUATIONS,
    ].includes("true") &&
    !["development", "test"].includes(process.env.NODE_ENV ?? "")
  )
    throw new Error("Demo seed is restricted to development/test.");
  if (process.env.SEED_DEMO_EVALUATIONS === "true") await seedEvaluationPreparation();
  if (process.env.SEED_DEMO_BACKOFFICE_USERS === "true") {
    // Public local-only credentials; never provision institutional access from this seed.
    for (const account of [
      {
        email: "operador.demo@doggycredit.local",
        fullName: "Operador Demo DoggyCredit",
        password: "DoggyDemo2026!",
      },
      {
        email: "revision.demo@doggycredit.local",
        fullName: "Revision Demo DoggyCredit",
        password: "DoggyRevision2026!",
      },
    ])
      await seedOperator(account.email, account.fullName, account.password);
  }
  if (process.env.SEED_DEMO_PLANS === "true") {
    if (!["development", "test"].includes(process.env.NODE_ENV ?? ""))
      throw new Error("Demo plans seed is restricted to development/test.");
    const plans = [
      {
        code: "BASIC",
        displayOrder: 1,
        name: "Básico",
        price: "0.00",
        requiresPayment: false,
        features: ["Funciones esenciales", "Gestión básica de usuarios", "Soporte por correo electrónico"],
      },
      {
        code: "PROFESSIONAL",
        displayOrder: 2,
        name: "Profesional",
        price: "349.00",
        requiresPayment: true,
        features: ["Funciones básicas incluidas", "Reportes avanzados", "Soporte prioritario"],
      },
      {
        code: "ENTERPRISE",
        displayOrder: 3,
        name: "Empresarial",
        price: "799.00",
        requiresPayment: true,
        features: [
          "Funciones profesionales incluidas",
          "Integraciones personalizadas",
          "Acompañamiento especializado",
        ],
      },
    ];
    for (const plan of plans)
      await prisma.plan.upsert({
        where: { code: plan.code },
        update: { isPublic: true, displayOrder: plan.displayOrder },
        create: { ...plan, isPublic: true, currency: "BOB", billingPeriod: "MONTHLY" },
      });
  }
  if (process.env.SEED_DEMO_PRODUCTS === "true") {
    const tenants = await prisma.tenant.findMany({
      where: {
        status: "ACTIVE",
        ...(process.env.SEED_DEMO_TENANT_SLUG ? { slug: process.env.SEED_DEMO_TENANT_SLUG } : {}),
      },
      select: { id: true },
    });
    for (const tenant of tenants)
      for (const product of demoProducts) {
        const existing = await prisma.financialProduct.findUnique({
          where: { tenantId_name: { tenantId: tenant.id, name: product.name } },
          select: { id: true },
        });
        if (existing) continue;
        await prisma.financialProduct.create({
          data: {
            tenant: { connect: { id: tenant.id } },
            name: product.name,
            category: product.category,
            applicantScope: product.applicantScope,
            minAmount: product.minAmount,
            maxAmount: product.maxAmount,
            active: false,
            purposes: { create: product.purposes.map((purpose) => ({ purpose })) },
          },
        });
      }
  }
  if (process.env.SEED_DEMO_OPERATOR !== "true") return;
  if (!["development", "test"].includes(process.env.NODE_ENV ?? "")) {
    throw new Error("Demo operator seed is restricted to development/test.");
  }
  const email = process.env.OPERATOR_SEED_EMAIL?.trim().toLowerCase();
  const fullName = process.env.OPERATOR_SEED_NAME?.trim();
  const password = process.env.OPERATOR_SEED_PASSWORD;
  if (
    !email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !fullName ||
    !password ||
    password.length < 12 ||
    password.length > 128
  ) {
    throw new Error(
      "Configure OPERATOR_SEED_NAME, OPERATOR_SEED_EMAIL and a 12-128 character OPERATOR_SEED_PASSWORD.",
    );
  }
  await seedOperator(email, fullName, password);
}

async function seedEvaluationPreparation() {
  const provider = await prisma.integrationProvider.upsert({
    where: { code: "BANK_MOCK" },
    update: {},
    create: { code: "BANK_MOCK", name: "Bank Mock", kind: "BANK", status: "ACTIVE" },
  });
  const fixtures = [
    {
      slug: "banco-del-sol-demo",
      legalName: "Banco del Sol Demo",
      taxId: "DEMO-HU10-SOL",
      ready: true,
      analystEmail: "carlos.hu10@doggycredit.local",
    },
    {
      slug: "banco-luna-demo",
      legalName: "Banco Luna Demo",
      taxId: "DEMO-HU10-LUNA",
      ready: true,
      analystEmail: "analista.luna.hu10@doggycredit.local",
    },
    {
      slug: "banco-pendiente-demo",
      legalName: "Banco Pendiente Demo",
      taxId: "DEMO-HU10-PENDIENTE",
      ready: false,
      analystEmail: "analista.pendiente.hu10@doggycredit.local",
    },
  ];
  for (const fixture of fixtures) {
    const tenant = await prisma.tenant.upsert({
      where: { slug: fixture.slug },
      update: {},
      create: {
        slug: fixture.slug,
        legalName: fixture.legalName,
        taxId: fixture.taxId,
        institutionType: "BANK",
        status: "ACTIVE",
        informationConfirmedAt: fixture.ready ? new Date("2026-10-01T12:00:00Z") : null,
        productsConfirmedAt: fixture.ready ? new Date("2026-10-01T12:00:00Z") : null,
      },
    });
    if (tenant.taxId !== fixture.taxId)
      throw new Error("Demo tenant slug is already used by another institution.");
    for (const account of [
      {
        email: fixture.analystEmail,
        name: "Carlos Pérez Demo",
        role: "ANALYST" as const,
        password: "DoggyAnalista2026!",
      },
      ...(fixture.slug === "banco-del-sol-demo"
        ? [
            {
              email: "ana.hu10@doggycredit.local",
              name: "Ana López Demo",
              role: "INSTITUTION_ADMIN" as const,
              password: "DoggyInstitucion2026!",
            },
          ]
        : []),
    ]) {
      const existing = await prisma.user.findUnique({ where: { email: account.email } });
      if (existing?.platformRole) throw new Error("Demo institutional account has a platform role.");
      const user =
        existing ??
        (await prisma.user.create({
          data: {
            email: account.email,
            fullName: account.name,
            passwordHash: await hashPassword(account.password),
            status: "ACTIVE",
            emailVerifiedAt: new Date("2026-10-01T12:00:00Z"),
          },
        }));
      await prisma.tenantMembership.upsert({
        where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
        update: {},
        create: { tenantId: tenant.id, userId: user.id, role: account.role, status: "ACTIVE" },
      });
    }
    if (fixture.ready) {
      await prisma.tenantIntegration.upsert({
        where: { tenantId_providerId: { tenantId: tenant.id, providerId: provider.id } },
        update: {},
        create: { tenantId: tenant.id, providerId: provider.id, enabled: true, status: "ACTIVE" },
      });
      for (const product of demoProducts)
        await prisma.financialProduct.upsert({
          where: { tenantId_name: { tenantId: tenant.id, name: product.name } },
          update: {},
          create: {
            tenantId: tenant.id,
            ...product,
            active: product.applicantScope === "PERSON",
            purposes: { create: product.purposes.map((purpose) => ({ purpose })) },
          },
        });
    }
    if (fixture.slug !== "banco-pendiente-demo") {
      const documentNumber = fixture.slug === "banco-del-sol-demo" ? "7812456" : "8899001";
      await prisma.client.upsert({
        where: {
          tenantId_documentType_documentNumber: { tenantId: tenant.id, documentType: "CI", documentNumber },
        },
        update: {},
        create: {
          tenantId: tenant.id,
          type: "PERSON",
          documentType: "CI",
          documentNumber,
          firstName: fixture.slug === "banco-del-sol-demo" ? "María Fernanda" : "Juan",
          lastName: "Rojas",
          name: fixture.slug === "banco-del-sol-demo" ? "María Fernanda Rojas" : "Juan Rojas",
          birthDate: new Date("1998-07-14"),
          phone: "71234567",
        },
      });
    }
  }
  console.log(
    "HU-10 demo fixtures ready. Existing manual changes were preserved; no evaluations or financial results were seeded.",
  );
}

async function seedOperator(email: string, fullName: string, password: string) {
  const existing = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } } });
  if (existing && existing.platformRole !== PlatformRole.OPERATOR) {
    throw new Error("Demo seed cannot replace a user with another role.");
  }
  if (existing && (await prisma.tenantMembership.count({ where: { userId: existing.id } }))) {
    throw new Error("Demo seed cannot modify a user with institutional memberships.");
  }
  const unchanged = existing?.passwordHash && (await verifyPassword(existing.passwordHash, password));
  const passwordHash = unchanged ? existing.passwordHash! : await hashPassword(password);
  await prisma.$transaction(async (tx) => {
    if (existing && !unchanged)
      await tx.adminSession.updateMany({
        where: { userId: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    await tx.user.upsert({
      where: { email: existing?.email ?? email },
      update: { fullName, passwordHash },
      create: {
        email,
        fullName,
        passwordHash,
        status: UserStatus.ACTIVE,
        platformRole: PlatformRole.OPERATOR,
        emailVerifiedAt: new Date(),
      },
    });
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await pool.end();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    await pool.end();
    process.exit(1);
  });
