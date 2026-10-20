import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import request from "supertest";
import { Test } from "@nestjs/testing";
import { AppModule } from "../dist/app.module.js";
import { configureApplication } from "../dist/common/configure-application.js";
import { PrismaService } from "../dist/infrastructure/prisma/prisma.service.js";
import { EmailDeliveryError, EmailSender } from "../dist/infrastructure/email/email-sender.js";
import { hashPassword } from "../dist/identity-tenants/auth/password-hashing.js";

describe("HU-33 password recovery (PostgreSQL)", () => {
  let app,
    db,
    mailFails = false,
    mailDelayMs = 0;
  const sent = [];
  const origin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  const oldPassword = "Frase anterior segura para pruebas";
  const newPassword = "Frase nueva segura para pruebas 2026";
  const post = (action, body) =>
    request(app.getHttpServer()).post(`/api/password-recovery/${action}`).send(body);
  const waitUntil = async (predicate) => {
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await predicate()) return;
      await delay(50);
    }
    assert.fail("Password recovery delivery did not finish");
  };
  const extract = async (email, previousCount = 0) => {
    await waitUntil(() => sent.filter((mail) => mail.to === email).length > previousCount);
    const token = sent.filter((mail) => mail.to === email).at(-1)?.text.match(/#token=([A-Za-z0-9_-]{43})/)?.[1];
    assert.ok(token);
    return token;
  };
  const loginInstitution = (email, password) =>
    request(app.getHttpServer())
      .post("/api/institution/auth/login")
      .set("Origin", origin)
      .set("X-DoggyCredit-Institution", "1")
      .send({ email, password });
  const loginAdmin = (email, password) =>
    request(app.getHttpServer())
      .post("/api/admin/auth/login")
      .set("Origin", origin)
      .set("X-DoggyCredit-Admin", "1")
      .send({ email, password });

  before(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailSender)
      .useValue({
        send: async (message) => {
          if (mailDelayMs) await delay(mailDelayMs);
          if (mailFails) throw new EmailDeliveryError(true);
          sent.push(message);
          return { channel: "TEST_INBOX" };
        },
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(app);
    await app.init();
    db = app.get(PrismaService);
  });
  after(async () => app?.close());

  async function fixture(platformRole = null) {
    const suffix = randomUUID().slice(0, 8);
    const user = await db.user.create({
      data: {
        email: `recovery-${suffix}@example.test`,
        fullName: `Persona ${suffix}`,
        passwordHash: await hashPassword(oldPassword),
        status: "ACTIVE",
        platformRole,
      },
    });
    return user;
  }

  it("returns the same public response for known and unknown addresses", async () => {
    const user = await fixture();
    mailDelayMs = 1800;
    const started = Date.now();
    const known = await post("request", { email: user.email }).expect(200);
    const knownDuration = Date.now() - started;
    const unknown = await post("request", { email: `unknown-${randomUUID()}@example.test` }).expect(200);
    assert.deepEqual(known.body, unknown.body);
    assert.equal(known.headers["referrer-policy"], "no-referrer");
    assert.ok(knownDuration < 1500, "SMTP latency must not expose account existence");
    await waitUntil(() => sent.some((mail) => mail.to === user.email));
    mailDelayMs = 0;
  });

  it("keeps one global identity and its memberships, revokes old institution sessions, and consumes once", async () => {
    const user = await fixture();
    for (const label of ["x", "y"]) {
      const tenant = await db.tenant.create({
        data: {
          slug: `recovery-${label}-${randomUUID().slice(0, 8)}`,
          legalName: `Banco ${label}`,
          taxId: `nit-${randomUUID()}`,
          institutionType: "BANK",
          status: "ACTIVE",
        },
      });
      await db.tenantMembership.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          role: "ANALYST",
          status: "ACTIVE",
        },
      });
    }
    const oldSession = await loginInstitution(user.email, oldPassword).expect(200);
    const cookie = oldSession.headers["set-cookie"][0];
    assert.equal(oldSession.body.resolution, "MULTIPLE_TENANTS");
    await post("request", { email: user.email }).expect(200);
    const token = await extract(user.email);
    await post("preview", { token }).expect(200);
    await post("preview", { token }).expect(200);
    const changes = await Promise.all([
      post("complete", { token, password: newPassword, confirmation: newPassword }),
      post("complete", { token, password: newPassword, confirmation: newPassword }),
    ]);
    assert.deepEqual(changes.map((result) => result.status).sort(), [200, 400]);
    await post("preview", { token }).expect(400);
    await loginInstitution(user.email, oldPassword).expect(401);
    const newSession = await loginInstitution(user.email, newPassword).expect(200);
    assert.equal(newSession.body.resolution, "MULTIPLE_TENANTS");
    await request(app.getHttpServer()).get("/api/institution/auth/me").set("Cookie", cookie).expect(401);
    const memberships = await db.tenantMembership.findMany({ where: { userId: user.id } });
    assert.equal(memberships.length, 2);
    assert.ok(memberships.every((row) => row.status === "ACTIVE"));
    const credential = await db.passwordResetToken.findFirstOrThrow({ where: { userId: user.id } });
    assert.notEqual(credential.tokenHash, token);
    assert.equal(credential.usedAt !== null, true);
    const audit = await db.auditLog.findMany({ where: { actorUserId: user.id } });
    assert.ok(audit.some((event) => event.action === "PASSWORD_RESET_COMPLETED"));
    assert.ok(!JSON.stringify(audit).includes(token));
    assert.ok(!JSON.stringify(audit).includes(newPassword));
  });

  it("recovers an internal operator and revokes the previous admin session", async () => {
    const user = await fixture("OPERATOR");
    const oldSession = await loginAdmin(user.email, oldPassword).expect(200);
    const cookie = oldSession.headers["set-cookie"][0];
    await post("request", { email: user.email }).expect(200);
    const token = await extract(user.email);
    assert.match(sent.at(-1).text, /from=internal#token=/);
    await post("complete", { token, password: newPassword, confirmation: newPassword }).expect(
      200,
    );
    await request(app.getHttpServer()).get("/api/admin/auth/session").set("Cookie", cookie).expect(401);
    await loginAdmin(user.email, oldPassword).expect(401);
    const fresh = await loginAdmin(user.email, newPassword).expect(200);
    assert.equal(fresh.body.user.platformRole, "OPERATOR");
  });

  it("recovers a platform administrator without creating an institutional membership", async () => {
    const user = await fixture("PLATFORM_ADMIN");
    await post("request", { email: user.email }).expect(200);
    const token = await extract(user.email);
    await post("complete", { token, password: newPassword, confirmation: newPassword }).expect(200);
    const fresh = await loginAdmin(user.email, newPassword).expect(200);
    assert.equal(fresh.body.user.platformRole, "PLATFORM_ADMIN");
    assert.equal(await db.tenantMembership.count({ where: { userId: user.id } }), 0);
  });

  it("keeps an institutional identity without memberships in the no-access state", async () => {
    const user = await fixture();
    await post("request", { email: user.email }).expect(200);
    await post("complete", { token: await extract(user.email), password: newPassword, confirmation: newPassword }).expect(200);
    const login = await loginInstitution(user.email, newPassword).expect(200);
    assert.equal(login.body.resolution, "NO_ACTIVE_TENANT");
    assert.equal(await db.tenantMembership.count({ where: { userId: user.id } }), 0);
  });

  it("limits repeated requests without revealing whether the address exists", async () => {
    const user = await fixture();
    const responses = [];
    for (let i = 0; i < 4; i++) responses.push((await post("request", { email: user.email }).expect(200)).body);
    assert.ok(responses.every((body) => JSON.stringify(body) === JSON.stringify(responses[0])));
    await extract(user.email);
    const rows = await db.passwordResetToken.findMany({ where: { userId: user.id } });
    assert.equal(rows.length, 1);
    await loginInstitution(user.email, oldPassword).expect(200);
  });

  it("keeps a suspended tenant unavailable while preserving an active tenant", async () => {
    const user = await fixture();
    for (const status of ["SUSPENDED", "ACTIVE"]) {
      const tenant = await db.tenant.create({ data: {
        slug: `recovery-${randomUUID().slice(0, 8)}`, legalName: `Banco ${status}`,
        taxId: `nit-${randomUUID()}`, institutionType: "BANK", status: "ACTIVE",
      } });
      await db.tenantMembership.create({ data: {
        tenantId: tenant.id, userId: user.id, role: "ANALYST", status,
      } });
    }
    await post("request", { email: user.email }).expect(200);
    await post("complete", { token: await extract(user.email), password: newPassword, confirmation: newPassword }).expect(200);
    const login = await loginInstitution(user.email, newPassword).expect(200);
    assert.equal(login.body.resolution, "SINGLE_TENANT");
    assert.match(login.body.tenant.name, /ACTIVE/);
    const rows = await db.tenantMembership.findMany({ where: { userId: user.id }, orderBy: { status: "asc" } });
    assert.deepEqual(rows.map((row) => row.status).sort(), ["ACTIVE", "SUSPENDED"]);
  });

  it("rejects invalid and expired tokens without changing the credential", async () => {
    const user = await fixture();
    await post("request", { email: user.email }).expect(200);
    const token = await extract(user.email);
    const hash = (await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash;
    await post("complete", {
      token: `${token[0] === "A" ? "B" : "A"}${token.slice(1)}`,
      password: newPassword,
      confirmation: newPassword,
    }).expect(400);
    await post("complete", { token, password: "short", confirmation: "short" }).expect(400);
    await post("complete", { token, password: newPassword, confirmation: "different" }).expect(400);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash, hash);
    await db.passwordResetToken.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(0) } });
    await post("complete", { token, password: newPassword, confirmation: newPassword }).expect(400);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).passwordHash, hash);
  });

  it("keeps the previous link valid after a failed delivery and supports retry", async () => {
    const user = await fixture();
    await post("request", { email: user.email }).expect(200);
    const first = await extract(user.email);
    await db.passwordResetToken.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(0) } });
    mailFails = true;
    await post("request", { email: user.email }).expect(200);
    await waitUntil(async () => !!(await db.passwordResetToken.findFirst({ where: { userId: user.id, sentAt: null, invalidatedAt: { not: null } } })));
    mailFails = false;
    await post("preview", { token: first }).expect(200);
    const failed = await db.passwordResetToken.findFirst({
      where: { userId: user.id, sentAt: null },
      orderBy: { createdAt: "desc" },
    });
    assert.ok(failed.invalidatedAt);
    await db.passwordResetToken.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(0) } });
    await post("request", { email: user.email }).expect(200);
    const replacement = await extract(user.email, 1);
    assert.notEqual(first, replacement);
    await post("preview", { token: first }).expect(400);
    await post("preview", { token: replacement }).expect(200);
  });
});
