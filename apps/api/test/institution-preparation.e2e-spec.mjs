import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { Test } from "@nestjs/testing";
import { AppModule } from "../dist/app.module.js";
import { configureApplication } from "../dist/common/configure-application.js";
import { PrismaService } from "../dist/infrastructure/prisma/prisma.service.js";
import { EmailSender } from "../dist/infrastructure/email/email-sender.js";
import { hashPassword } from "../dist/identity-tenants/auth/password-hashing.js";

describe("HU-08 institution preparation", () => {
  let app, db;
  const origin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  const password = "Institucion segura 2026!";
  const api = (slug) => `/api/institution/tenants/${slug}`;
  const get = (slug, cookie) =>
    request(app.getHttpServer())
      .get(`${api(slug)}/home`)
      .set("Cookie", cookie);
  const post = (slug, action, cookie, body = {}) =>
    request(app.getHttpServer())
      .post(`${api(slug)}/${action}`)
      .set("Cookie", cookie)
      .set("Origin", origin)
      .set("X-DoggyCredit-Institution", "1")
      .send(body);

  async function fixture(role = "INSTITUTION_ADMIN") {
    const suffix = randomUUID().slice(0, 8);
    const user = await db.user.create({
      data: {
        email: `hu08-${suffix}@example.test`,
        fullName: `Ana ${suffix}`,
        passwordHash: await hashPassword(password),
        status: "ACTIVE",
      },
    });
    const tenant = await db.tenant.create({
      data: {
        slug: `hu08-${suffix}`,
        legalName: `Banco ${suffix}`,
        taxId: `nit-${randomUUID()}`,
        institutionType: "BANK",
        status: "ACTIVE",
      },
    });
    await db.tenantMembership.create({
      data: { tenantId: tenant.id, userId: user.id, role, status: "ACTIVE" },
    });
    const login = async () =>
      (
        await request(app.getHttpServer())
          .post("/api/institution/auth/login")
          .set("Origin", origin)
          .set("X-DoggyCredit-Institution", "1")
          .send({ email: user.email, password })
          .expect(200)
      ).headers["set-cookie"][0];
    return { user, tenant, login };
  }

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

  it("persists 0/3 to 3/3, survives a new session, rejects foreign products and avoids repeated events", async () => {
    const x = await fixture();
    const y = await fixture();
    const cookie = await x.login();
    const product = await db.financialProduct.create({
      data: {
        tenantId: x.tenant.id,
        name: "Microcrédito Emprendedor",
        category: "MICRO_CREDIT",
        applicantScope: "PERSON",
        minAmount: "5000",
        maxAmount: "50000",
        active: false,
      },
    });
    const foreign = await db.financialProduct.create({
      data: {
        tenantId: y.tenant.id,
        name: "Crédito Verde",
        category: "GREEN_CREDIT",
        applicantScope: "PERSON",
        minAmount: "10000",
        maxAmount: "80000",
        active: false,
      },
    });
    const initial = await get(x.tenant.slug, cookie).expect(200);
    assert.equal(initial.body.completed, 0);
    assert.equal(initial.body.ready, false);
    await post(x.tenant.slug, "institution", cookie, {
      name: x.tenant.legalName,
      type: "BANK",
      taxId: "tampered",
    }).expect(400);
    const confirmed = await post(x.tenant.slug, "institution", cookie, {
      name: x.tenant.legalName,
      type: "BANK",
    }).expect(201);
    assert.equal(confirmed.body.completed, 1);
    await post(x.tenant.slug, "institution", cookie, { name: x.tenant.legalName, type: "BANK" }).expect(201);
    const source = await post(x.tenant.slug, "source", cookie).expect(201);
    assert.equal(source.body.completed, 2);
    assert.equal(source.body.source.enabled, true);
    await post(x.tenant.slug, "source", cookie).expect(201);
    await post(x.tenant.slug, "products", cookie, { productIds: [] }).expect(400);
    await post(x.tenant.slug, "products", cookie, { productIds: [foreign.id] }).expect(400);
    const ready = await post(x.tenant.slug, "products", cookie, { productIds: [product.id] }).expect(201);
    assert.equal(ready.body.ready, true);
    assert.equal(ready.body.completed, 3);
    assert.equal(ready.body.percentage, 100);
    await post(x.tenant.slug, "products", cookie, { productIds: [product.id] }).expect(201);
    const newCookie = await x.login();
    assert.equal((await get(x.tenant.slug, newCookie).expect(200)).body.completed, 3);
    assert.equal((await db.financialProduct.findUniqueOrThrow({ where: { id: foreign.id } })).active, false);
    assert.equal(await db.tenantIntegration.count({ where: { tenantId: x.tenant.id } }), 1);
    assert.equal(
      await db.auditLog.count({ where: { tenantId: x.tenant.id, action: "INSTITUTION_PREPARED" } }),
      1,
    );
    assert.equal(
      await db.auditLog.count({ where: { tenantId: x.tenant.id, action: "BANK_MOCK_ENABLED" } }),
      1,
    );
  });

  it("rejects cross-tenant URLs and prevents an analyst from changing preparation", async () => {
    const admin = await fixture();
    const other = await fixture();
    const analyst = await fixture("ANALYST");
    const adminCookie = await admin.login();
    await get(other.tenant.slug, adminCookie).expect(403);
    await post(other.tenant.slug, "source", adminCookie).expect(403);
    await post(other.tenant.slug, "products", adminCookie, { productIds: [randomUUID()] }).expect(403);
    const analystCookie = await analyst.login();
    await get(analyst.tenant.slug, analystCookie).expect(200);
    await post(analyst.tenant.slug, "institution", analystCookie, { name: "Forzado", type: "BANK" }).expect(
      403,
    );
    await post(analyst.tenant.slug, "source", analystCookie).expect(403);
    await post(analyst.tenant.slug, "products", analystCookie, { productIds: [randomUUID()] }).expect(403);
    assert.equal((await get(other.tenant.slug, await other.login()).expect(200)).body.completed, 0);
  });
});
