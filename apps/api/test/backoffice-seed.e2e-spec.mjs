import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { URL, fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pg from "pg";
import { verifyPassword } from "../dist/identity-tenants/auth/password-hashing.js";

describe("Local backoffice demo seed", () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  const emails = ["operador.demo@doggycredit.local", "revision.demo@doggycredit.local"];
  const passwords = ["DoggyDemo2026!", "DoggyRevision2026!"];
  const seed = (extra = {}) =>
    spawnSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
      cwd: root,
      env: {
        ...process.env,
        NODE_ENV: "test",
        SEED_DEMO_OPERATOR: "false",
        SEED_DEMO_PLANS: "false",
        SEED_DEMO_BACKOFFICE_USERS: "true",
        ...extra,
      },
      encoding: "utf8",
    });
  const users = async () =>
    (await db.query('SELECT * FROM "User" WHERE email = ANY($1) ORDER BY email', [emails])).rows;
  const counts = async () => {
    const values = [];
    for (const table of ["Tenant", "TenantMembership", "TenantSubscription", "MembershipInvitation", "Plan"])
      values.push((await db.query(`SELECT count(*) FROM "${table}"`)).rows[0].count);
    return values;
  };
  let baseline;
  before(async () => {
    assert.match(
      new URL(process.env.DATABASE_URL).pathname,
      /^\/doggycredit_e2e_test_[a-f0-9]{32}$/,
      "Run with npm run test:e2e, never against development data",
    );
    await db.connect();
    baseline = await counts();
    const result = seed();
    assert.equal(result.status, 0, result.stderr);
  });
  after(async () => {
    await db.query('DELETE FROM "User" WHERE email = ANY($1)', [emails]);
    await db.end();
  });
  it("creates only two active internal operators with working demo passwords", async () => {
    const rows = await users();
    assert.equal(rows.length, 2);
    for (const [index, row] of rows.entries()) {
      assert.equal(row.platformRole, "OPERATOR");
      assert.equal(row.status, "ACTIVE");
      assert.ok(await verifyPassword(row.passwordHash, passwords[index]));
      assert.notEqual(row.passwordHash, passwords[index]);
    }
    assert.deepEqual(await counts(), baseline);
  });
  it("is idempotent without changing hashes or institutional data", async () => {
    const previous = await users();
    assert.equal(seed().status, 0);
    const next = await users();
    assert.deepEqual(
      next.map((r) => [r.id, r.passwordHash]),
      previous.map((r) => [r.id, r.passwordHash]),
    );
    assert.deepEqual(await counts(), baseline);
  });
  it("rejects production before writing any demo data", async () => {
    const previous = await users();
    const result = seed({ NODE_ENV: "production", SEED_DEMO_PLANS: "true" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /restricted to development\/test/);
    assert.deepEqual(await users(), previous);
    assert.deepEqual(await counts(), baseline);
  });
  it("does not turn a non-operator into an operator", async () => {
    await db.query('UPDATE "User" SET "platformRole"=NULL WHERE email=$1', [emails[0]]);
    try {
      const result = seed();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /another role/);
      assert.equal((await users())[0].platformRole, null);
    } finally {
      await db.query('UPDATE "User" SET "platformRole"=\'OPERATOR\' WHERE email=$1', [emails[0]]);
    }
  });
  it("refuses to modify an operator who has institutional membership", async () => {
    const user = (await users())[0];
    const tenant = randomUUID();
    await db.query(
      'INSERT INTO "Tenant" (id, slug, "legalName", "taxId", "institutionType", "updatedAt") VALUES ($1,$2,$2,$2,\'OTHER\',now())',
      [tenant, tenant],
    );
    try {
      await db.query(
        'INSERT INTO "TenantMembership" (id,"tenantId","userId",role,"updatedAt") VALUES ($1,$2,$3,\'INSTITUTION_ADMIN\',now())',
        [randomUUID(), tenant, user.id],
      );
      const result = seed();
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /institutional memberships/);
      assert.equal((await users())[0].passwordHash, user.passwordHash);
    } finally {
      await db.query('DELETE FROM "TenantMembership" WHERE "tenantId"=$1', [tenant]);
      await db.query('DELETE FROM "Tenant" WHERE id=$1', [tenant]);
    }
  });
});
