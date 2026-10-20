import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { PrismaClient } from "../../apps/api/src/generated/prisma/client.js";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function run() {
  const tenants = await prisma.tenant.findMany({
    select: {
      id: true,
      slug: true,
      legalName: true,
      status: true,
      memberships: {
        select: {
          id: true,
          role: true,
          status: true,
          user: { select: { email: true, fullName: true } },
        },
      },
      _count: {
        select: {
          evaluations: true,
          clients: true,
          usageRecords: true,
          auditLogs: true,
        },
      },
    },
  });
  console.log(JSON.stringify(tenants, null, 2));
  await prisma.$disconnect();
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
