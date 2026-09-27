import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PlatformRole, PrismaClient, UserStatus } from "../apps/api/src/generated/prisma/client.js";
import { hashPassword, verifyPassword } from "../apps/api/src/identity-tenants/auth/password-hashing.js";

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
    ].includes("true") &&
    !["development", "test"].includes(process.env.NODE_ENV ?? "")
  )
    throw new Error("Demo seed is restricted to development/test.");
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
        name: "Básico",
        price: "0.00",
        requiresPayment: false,
        features: ["Funciones esenciales", "Gestión básica de usuarios", "Soporte por correo electrónico"],
      },
      {
        code: "PROFESSIONAL",
        name: "Profesional",
        price: "349.00",
        requiresPayment: true,
        features: ["Funciones básicas incluidas", "Reportes avanzados", "Soporte prioritario"],
      },
      {
        code: "ENTERPRISE",
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
        update: {},
        create: { ...plan, currency: "BOB", billingPeriod: "MONTHLY" },
      });
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
