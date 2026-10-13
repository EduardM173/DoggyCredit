import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import process from "node:process";
import pg from "pg";
import dotenv from "dotenv";

const api = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = resolve(api, "../..");
dotenv.config({ path: resolve(root, ".env"), quiet: true });
const name = `doggycredit_e2e_test_${randomUUID().replaceAll("-", "")}`;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
let created = false;
try {
  await db.connect();
  assert.match(name, /^doggycredit_e2e_test_[a-f0-9]{32}$/);
  await db.query(`CREATE DATABASE "${name}"`);
  created = true;
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${name}`;
  const env = { ...process.env, DATABASE_URL: url.toString(), TENANT_PROVISIONING_ENABLED: "false" };
  execFileSync(process.execPath, [resolve(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"], {
    cwd: root,
    env,
    stdio: "pipe",
  });
  console.log("Running e2e against a disposable database; development data is untouched.");
  const files = readdirSync(resolve(api, "test"))
    .filter((f) => f.endsWith(".e2e-spec.mjs"))
    .filter((f) => !process.env.E2E_TEST_FILE || f === process.env.E2E_TEST_FILE)
    .map((f) => `test/${f}`);
  process.exitCode = await new Promise((done, reject) => {
    const child = spawn(process.execPath, ["--test", "--test-concurrency=1", ...files], {
      cwd: api,
      env,
      stdio: "inherit",
    });
    const cancel = () => child.kill();
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    child.once("error", reject);
    child.once("exit", (code) => {
      process.off("SIGINT", cancel);
      process.off("SIGTERM", cancel);
      done(code ?? 1);
    });
  });
} catch {
  console.error("E2E setup/run failed. A test database role with CREATEDB is required.");
  process.exitCode = 1;
} finally {
  try {
    if (created) {
      assert.match(name, /^doggycredit_e2e_test_[a-f0-9]{32}$/);
      await db.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    }
  } finally {
    await db.end();
  }
}
import console from "node:console";
