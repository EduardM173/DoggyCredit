import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PlatformRole, PrismaClient, UserStatus } from "../apps/api/src/generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to seed the database.");
}

const pool = new Pool({ connectionString });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  await prisma.user.upsert({
    where: { email: "dev.admin@doggysoftware.local" },
    update: {},
    create: {
      email: "dev.admin@doggysoftware.local",
      fullName: "Doggy Software Dev Admin",
      status: UserStatus.ACTIVE,
      platformRole: PlatformRole.PLATFORM_ADMIN,
      emailVerifiedAt: new Date(),
    },
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
