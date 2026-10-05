import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import { before, after, describe, it } from "node:test";
import request from "supertest";
import { Test } from "@nestjs/testing";
import { AppModule } from "../dist/app.module.js";
import { configureApplication } from "../dist/common/configure-application.js";
import { PrismaService } from "../dist/infrastructure/prisma/prisma.service.js";
import { EmailSender } from "../dist/infrastructure/email/email-sender.js";
import { hashPassword } from "../dist/identity-tenants/auth/password-hashing.js";

describe("HU-07 institutional login and tenant isolation", () => {
  let app, db;
  const origin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  const password = "  mi frase segura con cafe\u0301  ";
  const login = (body) =>
    request(app.getHttpServer())
      .post("/api/institution/auth/login")
      .set("Origin", origin)
      .set("X-DoggyCredit-Institution", "1")
      .send(body);
  const logout = (cookie) =>
    request(app.getHttpServer())
      .post("/api/institution/auth/logout")
      .set("Origin", origin)
      .set("X-DoggyCredit-Institution", "1")
      .set("Cookie", cookie)
      .send({});
  const get = (path, cookie) =>
    request(app.getHttpServer())
      .get(`/api/institution${path}`)
      .set("Cookie", cookie ?? "");
  const fixture = async (options = {}) => {
    const suffix = randomUUID().slice(0, 8);
    const user = await db.user.create({
      data: {
        email: `hu07-${suffix}@example.test`,
        fullName: "Ana María López",
        passwordHash: await hashPassword(password.normalize("NFC")),
        status: options.userStatus ?? "ACTIVE",
        platformRole: options.platformRole ?? null,
      },
    });
    const addTenant = async (status = "ACTIVE", membershipStatus = "ACTIVE") => {
      const tenant = await db.tenant.create({
        data: {
          slug: `banco-${randomUUID().slice(0, 8)}`,
          legalName: `Banco de prueba ${suffix}`,
          taxId: `nit-${randomUUID()}`,
          institutionType: "BANK",
          status,
        },
      });
      const membership = await db.tenantMembership.create({
        data: { tenantId: tenant.id, userId: user.id, role: "INSTITUTION_ADMIN", status: membershipStatus },
      });
      return { tenant, membership };
    };
    return { user, addTenant };
  };
  before(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailSender)
      .useValue({ send: async () => {} })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(app);
    await app.init();
    db = app.get(PrismaService);
  });
  after(async () => app?.close());

  it("authenticates the global User with the HU-06 NFC password and creates a separate opaque session", async () => {
    const f = await fixture();
    const x = await f.addTenant();
    const res = await login({ email: `  ${f.user.email.toUpperCase()}  `, password }).expect(200);
    assert.equal(res.body.resolution, "SINGLE_TENANT");
    assert.equal(res.body.tenant.slug, x.tenant.slug);
    assert.doesNotMatch(JSON.stringify(res.body), /tokenHash|passwordHash|sessionToken|platformRole/);
    const cookie = res.headers["set-cookie"][0];
    assert.match(cookie, /dc-institution-session=.*HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.doesNotMatch(cookie, /Domain=/);
    const token = /dc-institution-session=([^;]+)/.exec(cookie)[1];
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const stored = await db.institutionSession.findFirstOrThrow({ where: { userId: f.user.id } });
    assert.equal(stored.tokenHash, createHash("sha256").update(token).digest("hex"));
    assert.notEqual(stored.tokenHash, token);
    const admin = await get(`/tenants/${x.tenant.slug}/home`, `doggycredit_admin=${token}`).expect(401);
    assert.equal(admin.body.statusCode, 401);
    const me = await get("/auth/me", cookie).expect(200);
    assert.equal(me.body.activeMemberships.length, 1);
    assert.equal(me.body.activeMemberships[0].tenant.slug, x.tenant.slug);
    const home = await get(`/tenants/${x.tenant.slug}/home`, cookie).expect(200);
    assert.equal(home.body.tenant.taxId, x.tenant.taxId);
    assert.equal(home.body.user.name, f.user.fullName);
    assert.equal(home.body.membership.role, "INSTITUTION_ADMIN");
    const tampered = await get(`/tenants/${x.tenant.slug}/home?tenantId=${randomUUID()}`, cookie).expect(200);
    assert.equal(tampered.body.tenant.slug, x.tenant.slug);
    await request(app.getHttpServer()).get("/api/admin/auth/session").set("Cookie", cookie).expect(401);
    assert.match(home.headers["cache-control"], /no-store/);
    assert.equal(home.headers["referrer-policy"], "no-referrer");
  });
  it("uses uniform failure for wrong, missing, and globally blocked Users", async () => {
    const f = await fixture();
    await f.addTenant();
    const wrong = await login({ email: f.user.email, password: "not the password" }).expect(401);
    const missing = await login({ email: `missing-${randomUUID()}@example.test`, password }).expect(401);
    await db.user.update({ where: { id: f.user.id }, data: { status: "BLOCKED" } });
    const blocked = await login({ email: f.user.email, password }).expect(401);
    assert.equal(wrong.body.message, missing.body.message);
    assert.equal(blocked.body.message, missing.body.message);
    await login({ email: f.user.email, password, tenantSlug: "forged" }).expect(400);
  });
  it("resolves zero and multiple active memberships without leaking inactive ones", async () => {
    const zero = await fixture({ platformRole: "OPERATOR" });
    const invited = await zero.addTenant("ACTIVE", "INVITED");
    const noAccess = await login({ email: zero.user.email, password }).expect(200);
    assert.equal(noAccess.body.resolution, "NO_ACTIVE_TENANT");
    await get(`/tenants/${invited.tenant.slug}/home`, noAccess.headers["set-cookie"][0]).expect(403);
    const f = await fixture();
    const x = await f.addTenant();
    const y = await f.addTenant();
    const inactive = await f.addTenant("ACTIVE", "SUSPENDED");
    const res = await login({ email: f.user.email, password }).expect(200);
    assert.equal(res.body.resolution, "MULTIPLE_TENANTS");
    assert.deepEqual(new Set(res.body.tenants.map((t) => t.slug)), new Set([x.tenant.slug, y.tenant.slug]));
    const cookie = res.headers["set-cookie"][0];
    await get(`/tenants/${x.tenant.slug}/home`, cookie).expect(200);
    await get(`/tenants/${y.tenant.slug}/home`, cookie).expect(200);
    await get(`/tenants/${inactive.tenant.slug}/home`, cookie).expect(403);
    const simultaneous = await Promise.all([
      get(`/tenants/${x.tenant.slug}/home`, cookie),
      get(`/tenants/${y.tenant.slug}/home`, cookie),
    ]);
    assert.deepEqual(
      simultaneous.map((item) => item.body.tenant.slug),
      [x.tenant.slug, y.tenant.slug],
    );
    await get("/auth/me", cookie)
      .expect(200)
      .then((r) => assert.equal(r.body.activeMemberships.length, 2));
  });
  it("denies forged slug and revoked membership on the next request", async () => {
    const f = await fixture();
    const x = await f.addTenant();
    const outsider = await fixture();
    const y = await outsider.addTenant();
    const cookie = (await login({ email: f.user.email, password }).expect(200)).headers["set-cookie"][0];
    const adminToken = randomBytes(32).toString("base64url");
    await db.adminSession.create({
      data: {
        userId: f.user.id,
        tokenHash: createHash("sha256").update(adminToken).digest("hex"),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
    await get(`/tenants/${x.tenant.slug}/home`, `doggycredit_admin=${adminToken}`).expect(401);
    await get(`/tenants/${x.tenant.slug}/home`, cookie).expect(200);
    const denied = await get(`/tenants/${y.tenant.slug}/home`, cookie).expect(403);
    assert.doesNotMatch(JSON.stringify(denied.body), new RegExp(y.tenant.legalName));
    await get(`/tenants/not-real-${randomUUID().slice(0, 8)}/home`, cookie).expect(404);
    await db.tenantMembership.update({ where: { id: x.membership.id }, data: { status: "SUSPENDED" } });
    await get(`/tenants/${x.tenant.slug}/home`, cookie).expect(403);
    const me = await get("/auth/me", cookie).expect(200);
    assert.equal(me.body.activeMemberships.length, 0);
  });
  it("enforces idle and absolute expiry, revokes logout, and leaves admin sessions separate", async () => {
    const f = await fixture();
    await f.addTenant();
    const cookie = (await login({ email: f.user.email, password }).expect(200)).headers["set-cookie"][0];
    const token = /dc-institution-session=([^;]+)/.exec(cookie)[1];
    const session = await db.institutionSession.findUniqueOrThrow({
      where: { tokenHash: createHash("sha256").update(token).digest("hex") },
    });
    await db.institutionSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date(0) } });
    await get("/auth/me", cookie).expect(401);
    await db.institutionSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
    await get("/auth/me", cookie).expect(200);
    await db.institutionSession.update({ where: { id: session.id }, data: { expiresAt: new Date(0) } });
    await get("/auth/me", cookie).expect(401);
    await db.institutionSession.update({
      where: { id: session.id },
      data: { expiresAt: new Date(Date.now() + 3600000) },
    });
    await logout(cookie).expect(204);
    await logout(cookie).expect(204);
    await get("/auth/me", cookie).expect(401);
    assert.ok((await db.institutionSession.findUniqueOrThrow({ where: { id: session.id } })).revokedAt);
    assert.equal(await db.adminSession.count({ where: { userId: f.user.id } }), 0);
  });
  it("requires expected origin and a custom header for login and logout", async () => {
    await request(app.getHttpServer()).post("/api/institution/auth/login").send({}).expect(403);
    await request(app.getHttpServer()).post("/api/institution/auth/logout").send({}).expect(403);
    await request(app.getHttpServer()).get("/api/institution/auth/logout").expect(404);
  });
});
