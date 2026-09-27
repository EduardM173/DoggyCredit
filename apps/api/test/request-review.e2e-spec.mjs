import assert from "node:assert/strict";
import process from "node:process";
import { URL } from "node:url";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { before, after, describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import request from "supertest";
import { AppModule } from "../dist/app.module.js";
import { configureApplication } from "../dist/common/configure-application.js";
import { PrismaService } from "../dist/infrastructure/prisma/prisma.service.js";
import { EmailSender } from "../dist/infrastructure/email/email-sender.js";
import { AuditWriter } from "../dist/audit/public.js";
import { hashPassword } from "../dist/identity-tenants/auth/password-hashing.js";

describe("HU-03 administrative review (PostgreSQL)", () => {
  let app, prisma, operator, cookie, origin;
  const run = `HU03-${randomUUID()}`;
  const password = randomBytes(24).toString("base64url");
  const requestIds = [];
  const hash = (token) => createHash("sha256").update(token).digest("hex");
  const get = (path) => request(app.getHttpServer()).get(`/api/admin${path}`).set("Cookie", cookie);
  const post = (path, body = {}) =>
    request(app.getHttpServer())
      .post(`/api/admin${path}`)
      .set("Cookie", cookie)
      .set("Origin", origin)
      .set("X-DoggyCredit-Admin", "1")
      .send(body);
  const create = async (data = {}) => {
    const row = await prisma.institutionRequest.create({
      data: {
        institutionName: run,
        taxId: randomBytes(9).toString("hex"),
        institutionType: "BANK",
        planInterest: "UNSURE",
        contactName: "Test contact",
        contactRole: "Manager",
        contactEmail: `${randomUUID()}@example.test`,
        contactPhone: "+59171234567",
        status: "PENDING_REVIEW",
        emailVerifiedAt: new Date(),
        ...data,
      },
    });
    requestIds.push(row.id);
    return row;
  };
  before(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailSender)
      .useValue({ send: async () => {} })
      .compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    origin = new URL(app.get(ConfigService).getOrThrow("WEB_ORIGIN")).origin;
    operator = await prisma.user.create({
      data: {
        email: `${run}@example.test`.toLowerCase(),
        fullName: run,
        platformRole: "OPERATOR",
        status: "ACTIVE",
        passwordHash: await hashPassword(password),
      },
    });
    const token = randomBytes(32).toString("base64url");
    await prisma.adminSession.create({
      data: { userId: operator.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + 3600000) },
    });
    cookie = `doggycredit_admin=${token}`;
  });
  after(async () => {
    try {
      if (prisma) {
        await prisma.auditLog.deleteMany({ where: { entityId: { in: requestIds } } });
        await prisma.institutionRequest.deleteMany({ where: { id: { in: requestIds } } });
        if (operator) await prisma.user.delete({ where: { id: operator.id } });
      }
    } finally {
      await app?.close();
    }
  });
  it("authenticates OPERATOR, returns safe identity and secure scoped cookie", async () => {
    const response = await post("/auth/login", { email: operator.email, password }).expect(200);
    const setCookie = response.headers["set-cookie"][0];
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Strict/);
    assert.match(setCookie, /Path=\/api\/admin/);
    assert.equal(response.body.user.id, operator.id);
    assert.ok(new Date(response.body.expiresAt) > new Date());
    assert.doesNotMatch(JSON.stringify(response.body), /passwordHash|tokenHash|"token"/);
    // Login rotates a presented session, so subsequent tests use the new cookie.
    await get("/auth/session").expect(401);
    cookie = setCookie.split(";")[0];
    await get("/auth/session").expect(200).expect("Cache-Control", "no-store");
  });
  it("uses uniform errors for incorrect password, missing and unauthorized account", async () => {
    const wrong = await post("/auth/login", { email: operator.email, password: "incorrect" }).expect(401);
    const absent = await post("/auth/login", { email: `${randomUUID()}@example.test`, password }).expect(401);
    await prisma.user.update({ where: { id: operator.id }, data: { platformRole: null } });
    try {
      const denied = await post("/auth/login", { email: operator.email, password }).expect(401);
      assert.equal(wrong.body.message, absent.body.message);
      assert.equal(wrong.body.message, denied.body.message);
      await get("/institution-requests").expect(403);
    } finally {
      await prisma.user.update({ where: { id: operator.id }, data: { platformRole: "OPERATOR" } });
    }
  });
  it("protects every read and mutation without authentication", async () => {
    const id = randomUUID();
    for (const path of ["/auth/session", "/institution-requests", `/institution-requests/${id}`])
      await request(app.getHttpServer()).get(`/api/admin${path}`).expect(401);
    for (const action of ["approve", "reject"])
      await request(app.getHttpServer())
        .post(`/api/admin/institution-requests/${id}/${action}`)
        .set("Origin", origin)
        .set("X-DoggyCredit-Admin", "1")
        .send({})
        .expect(401);
  });
  it("requires CSRF origin and custom header for mutations including logout/login", async () => {
    for (const path of [
      "auth/login",
      "auth/logout",
      `institution-requests/${randomUUID()}/approve`,
      `institution-requests/${randomUUID()}/reject`,
    ]) {
      await request(app.getHttpServer())
        .post(`/api/admin/${path}`)
        .set("Cookie", cookie)
        .set("Origin", "https://evil.example")
        .set("X-DoggyCredit-Admin", "1")
        .send({})
        .expect(403);
      await request(app.getHttpServer())
        .post(`/api/admin/${path}`)
        .set("Cookie", cookie)
        .set("Origin", origin)
        .send({})
        .expect(403);
    }
  });
  it("lists, searches case-insensitively by name/email, normalizes NIT and filters state", async () => {
    const row = await create({
      institutionName: `${run} Banco Prueba`,
      taxId: `${Date.now()}7`,
      contactEmail: `${run.toLowerCase()}@example.test`,
    });
    for (const search of [
      row.institutionName.toUpperCase(),
      row.contactEmail.toUpperCase(),
      row.taxId.slice(0, 5) + "-" + row.taxId.slice(5),
    ]) {
      const response = await get(
        `/institution-requests?search=${encodeURIComponent(search)}&status=PENDING_REVIEW`,
      ).expect(200);
      assert.ok(response.body.items.some((item) => item.id === row.id));
      assert.ok(response.body.items.every((item) => item.status === "PENDING_REVIEW"));
      assert.equal(response.body.page, 1);
      assert.equal(response.body.pageSize, 10);
    }
  });
  it("uses UTC inclusive/exclusive day boundaries", async () => {
    const suffix = `${run}-date`;
    const start = await create({ institutionName: suffix, createdAt: new Date("2026-01-15T00:00:00Z") });
    const end = await create({ institutionName: suffix, createdAt: new Date("2026-01-15T23:59:59.999Z") });
    await create({ institutionName: suffix, createdAt: new Date("2026-01-16T00:00:00Z") });
    const response = await get(`/institution-requests?search=${suffix}&date=2026-01-15`).expect(200);
    assert.deepEqual(
      response.body.items.map((item) => item.id),
      [end.id, start.id],
    );
  });
  it("paginates server-side with deterministic unique-id tie break", async () => {
    const suffix = `${run}-pages`;
    const ids = [];
    for (let i = 0; i < 3; i++)
      ids.push((await create({ institutionName: suffix, createdAt: new Date("2026-01-01T12:00:00Z") })).id);
    ids.sort().reverse();
    for (let page = 1; page <= 3; page++) {
      const response = await get(`/institution-requests?search=${suffix}&pageSize=1&page=${page}`).expect(
        200,
      );
      assert.equal(response.body.total, 3);
      assert.equal(response.body.totalPages, 3);
      assert.equal(response.body.items[0].id, ids[page - 1]);
    }
  });
  it("validates pagination, date, search, status, identifiers and unknown fields", async () => {
    for (const query of [
      "page=0",
      "pageSize=101",
      "date=2026-02-30",
      "status=APROBADA",
      "unknown=1",
      "search=" + "x".repeat(181),
    ])
      await get(`/institution-requests?${query}`).expect(400);
    await get("/institution-requests/not-a-uuid").expect(400);
    const row = await create();
    await post(`/institution-requests/${row.id}/approve`, { actorUserId: randomUUID() }).expect(400);
    await post(`/institution-requests/${row.id}/reject`, { reason: "x".repeat(501) }).expect(400);
  });
  it("returns detail and informative interest without hashes or tokens; nonexistent is 404", async () => {
    const row = await create();
    await prisma.emailVerificationToken.create({
      data: {
        requestId: row.id,
        tokenHash: hash(randomBytes(32).toString("hex")),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    const response = await get(`/institution-requests/${row.id}`).expect(200);
    assert.equal(response.body.planInterest, "UNSURE");
    assert.ok(response.body.emailVerifiedAt);
    assert.doesNotMatch(JSON.stringify(response.body), /password|token|session|requestedPlanId/i);
    await get(`/institution-requests/${randomUUID()}`).expect(404);
  });
  for (const [action, status] of [
    ["approve", "APPROVED"],
    ["reject", "REJECTED"],
  ]) {
    it(`${action} changes only request, records actor/audit, never provisions`, async () => {
      const row = await create();
      const counts = async () =>
        Promise.all([
          prisma.tenant.count(),
          prisma.tenantMembership.count(),
          prisma.tenantSubscription.count(),
          prisma.membershipInvitation.count(),
          prisma.user.count(),
        ]);
      const before = await counts();
      const response = await post(
        `/institution-requests/${row.id}/${action}`,
        action === "reject" ? { reason: "  Datos insuficientes  " } : {},
      ).expect(200);
      assert.equal(response.body.status, status);
      assert.equal(response.body.planInterest, row.planInterest);
      assert.equal(response.body.reviewer.fullName, operator.fullName);
      assert.ok(response.body.reviewedAt);
      const saved = await prisma.institutionRequest.findUniqueOrThrow({ where: { id: row.id } });
      assert.equal(saved.reviewedById, operator.id);
      assert.equal(saved.requestedPlanId, null);
      if (action === "reject") assert.equal(saved.rejectionReason, "Datos insuficientes");
      const events = await prisma.auditLog.findMany({ where: { entityId: row.id } });
      assert.equal(events.length, 1);
      assert.equal(events[0].actorUserId, operator.id);
      assert.equal(events[0].action, `INSTITUTION_REQUEST_${status}`);
      assert.ok(events[0].createdAt);
      assert.deepEqual(events[0].metadata, { fromStatus: "PENDING_REVIEW", toStatus: status });
      assert.deepEqual(await counts(), before);
      for (const next of ["approve", "reject"])
        await post(`/institution-requests/${row.id}/${next}`).expect(409);
      assert.equal(await prisma.auditLog.count({ where: { entityId: row.id } }), 1);
    });
  }
  it("rejects EMAIL_PENDING and inconsistent unverified PENDING_REVIEW without audit", async () => {
    for (const status of ["EMAIL_PENDING", "PENDING_REVIEW"]) {
      const row = await create({ status, emailVerifiedAt: null });
      for (const action of ["approve", "reject"])
        await post(`/institution-requests/${row.id}/${action}`).expect(409);
      assert.equal(await prisma.auditLog.count({ where: { entityId: row.id } }), 0);
    }
  });
  it("allows exactly one concurrent decision and one audit", async () => {
    const row = await create();
    const results = await Promise.all([
      post(`/institution-requests/${row.id}/approve`),
      post(`/institution-requests/${row.id}/reject`),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal(await prisma.auditLog.count({ where: { entityId: row.id } }), 1);
  });
  it("rolls back the status and audit together when audit fails", async () => {
    const row = await create();
    const writer = app.get(AuditWriter);
    const original = writer.recordRequestDecision;
    writer.recordRequestDecision = async function (event) {
      await original.call(this, event);
      throw new Error("Intentional audit rollback test");
    };
    try {
      await post(`/institution-requests/${row.id}/approve`).expect(500);
    } finally {
      writer.recordRequestDecision = original;
    }
    const saved = await prisma.institutionRequest.findUniqueOrThrow({ where: { id: row.id } });
    assert.equal(saved.status, "PENDING_REVIEW");
    assert.equal(saved.reviewedAt, null);
    assert.equal(saved.reviewedById, null);
    assert.equal(await prisma.auditLog.count({ where: { entityId: row.id } }), 0);
  });
  it("does not allow GET mutations", async () => {
    const row = await create();
    for (const path of [
      `/institution-requests/${row.id}/approve`,
      `/institution-requests/${row.id}/reject`,
      "/auth/logout",
    ])
      await get(path).expect(404);
  });
  it("rejects expired sessions and disabled users", async () => {
    const token = randomBytes(32).toString("base64url");
    await prisma.adminSession.create({
      data: { userId: operator.id, tokenHash: hash(token), expiresAt: new Date(Date.now() - 1000) },
    });
    await request(app.getHttpServer())
      .get("/api/admin/auth/session")
      .set("Cookie", `doggycredit_admin=${token}`)
      .expect(401);
    await prisma.user.update({ where: { id: operator.id }, data: { status: "BLOCKED" } });
    try {
      await get("/auth/session").expect(401);
    } finally {
      await prisma.user.update({ where: { id: operator.id }, data: { status: "ACTIVE" } });
    }
  });
  it("refuses demo seed in production", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "../../prisma/seed.ts"], {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: "production", SEED_DEMO_OPERATOR: "true" },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /restricted to development\/test/);
  });
  it("logs out, expires cookie and revokes session server-side", async () => {
    const response = await post("/auth/logout").expect(204);
    assert.match(response.headers["set-cookie"][0], /Expires=Thu, 01 Jan 1970/);
    await get("/auth/session").expect(401);
    await post("/auth/logout").expect(204);
  });
});
