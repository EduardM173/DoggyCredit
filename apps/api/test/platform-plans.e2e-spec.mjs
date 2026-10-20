import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { Test } from "@nestjs/testing";
import { AppModule } from "../dist/app.module.js";
import { configureApplication } from "../dist/common/configure-application.js";
import { PrismaService } from "../dist/infrastructure/prisma/prisma.service.js";

describe("HU-29 catálogo global de planes", () => {
  let app, db, admin, operator, planId;
  const origin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  const cookieFor = async (role) => {
    const user = await db.user.create({ data: {
      email: `${randomUUID()}@example.test`, fullName: role, platformRole: role, status: "ACTIVE",
    } });
    const token = randomBytes(32).toString("base64url");
    await db.adminSession.create({ data: {
      userId: user.id, tokenHash: createHash("sha256").update(token).digest("hex"),
      expiresAt: new Date(Date.now() + 3600000),
    } });
    return { user, cookie: `doggycredit_admin=${token}` };
  };
  const post = (path, body, cookie = admin.cookie) => request(app.getHttpServer())
    .post(`/api/admin/platform/plans${path}`).set("Origin", origin)
    .set("X-DoggyCredit-Admin", "1").set("Cookie", cookie).send(body);
  const list = (cookie = admin.cookie) => request(app.getHttpServer())
    .get("/api/admin/platform/plans").set("Cookie", cookie);
  before(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(app);
    await app.init();
    db = app.get(PrismaService);
    admin = await cookieFor("PLATFORM_ADMIN");
    operator = await cookieFor("OPERATOR");
  });
  after(async () => app?.close());

  it("solo PLATFORM_ADMIN crea y consulta; el DTO rechaza campos internos", async () => {
    const body = {
      code: `HU29_${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`,
      name: "Plan de prueba", description: null, price: "100.00", currency: "BOB",
      billingPeriod: "MONTHLY", requiresPayment: true, evaluationLimitMode: "LIMITADO",
      evaluationsPerMonth: 25, maxUsers: 4, features: ["Evaluaciones"],
    };
    await list(operator.cookie).expect(403);
    await post("", body, operator.cookie).expect(403);
    await post("", { ...body, active: true }).expect(400);
    const created = await post("", body).expect(201);
    planId = created.body.id;
    assert.equal(created.body.active, false);
    assert.equal(created.body.price, "100");
    assert.ok((await list().expect(200)).body.some((item) => item.id === planId));
    assert.ok(!(await request(app.getHttpServer()).get("/api/public/plans").expect(200)).body.some((item) => item.code === body.code));
  });

  it("activa oferta, preserva términos y rechaza una revisión antigua", async () => {
    const activated = await post(`/${planId}/status`, { active: true, expectedRevision: 1 }).expect(200);
    assert.equal(activated.body.plan.revision, 2);
    assert.ok((await request(app.getHttpServer()).get("/api/public/plans").expect(200)).body.some((item) => item.code === activated.body.plan.code));
    const oldTerms = {
      price: activated.body.plan.price, evaluationsPerMonth: activated.body.plan.evaluationsPerMonth,
    };
    const edit = {
      name: activated.body.plan.name, description: null, price: "150.00", currency: "BOB",
      billingPeriod: "MONTHLY", requiresPayment: true, evaluationLimitMode: "LIMITADO",
      evaluationsPerMonth: 50, maxUsers: 4, features: ["Evaluaciones"], expectedRevision: 2,
    };
    await post(`/${planId}`, edit, operator.cookie).expect(403);
    await post(`/${planId}`, edit).expect(200);
    await post(`/${planId}`, edit).expect(409);
    const current = await db.plan.findUniqueOrThrow({ where: { id: planId } });
    assert.equal(current.price.toFixed(2), "150.00");
    assert.equal(current.evaluationsPerMonth, 50);
    assert.deepEqual(oldTerms, { price: "100", evaluationsPerMonth: 25 });
    const audit = await db.auditLog.findMany({ where: { entityType: "Plan", entityId: planId } });
    assert.deepEqual(audit.map((row) => row.action).sort(), ["PLAN_ACTIVATED", "PLAN_CREATED", "PLAN_UPDATED"]);
    assert.equal(audit.find((row) => row.action === "PLAN_UPDATED").metadata.before.evaluationsPerMonth, 25);
    await post(`/${planId}/status`, { active: false, expectedRevision: 3 }).expect(200);
    assert.ok(!(await request(app.getHttpServer()).get("/api/public/plans").expect(200)).body.some((item) => item.code === current.code));
  });
});
