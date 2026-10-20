import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../apps/api/src/generated/prisma/client.js";
import { activationPassword } from "../apps/api/src/identity-tenants/activation/activation-password.js";
import { hashPassword } from "../apps/api/src/identity-tenants/auth/password-hashing.js";

const email = process.env.PLATFORM_ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
const fullName = process.env.PLATFORM_ADMIN_BOOTSTRAP_NAME?.trim();
const password = process.env.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD;
const connectionString = process.env.DATABASE_URL;
if (!connectionString || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName || !password)
  throw new Error("Configure DATABASE_URL and PLATFORM_ADMIN_BOOTSTRAP_EMAIL/NAME/PASSWORD.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
async function main() {
  try {
    const passwordHash = await hashPassword(activationPassword(password));
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(31031)`;
      const existingAdmin = await tx.user.count({ where: { platformRole: "PLATFORM_ADMIN" } });
      if (existingAdmin > 0) return "SKIPPED";
      const existingIdentity = await tx.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
      });
      if (existingIdentity)
        throw new Error("The bootstrap email already belongs to an identity; manual recovery is required.");
      const user = await tx.user.create({
        data: {
          email,
          fullName,
          passwordHash,
          passwordChangedAt: new Date(),
          status: "ACTIVE",
          platformRole: "PLATFORM_ADMIN",
          platformAccessStatus: "ACTIVE",
          emailVerifiedAt: new Date(),
        },
      });
      await tx.auditLog.create({
        data: {
          action: "PLATFORM_ADMIN_BOOTSTRAPPED",
          entityType: "User",
          entityId: user.id,
          metadata: { role: "PLATFORM_ADMIN", result: "CREATED" },
        },
      });
      return "CREATED";
    });
    process.stdout.write(`Platform bootstrap: ${result}.\n`);
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(() => {
  process.stderr.write("Platform bootstrap failed; verify configuration and database state.\n");
  process.exitCode = 1;
});
