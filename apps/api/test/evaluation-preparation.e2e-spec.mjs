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
import { AuditWriter } from "../dist/audit/public.js";
describe("HU-10 evaluation preparation", () => {
  let app, db, provider, x, y, notReady, admin, passwordHash;
  const origin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  const password = "Analista seguro 2026!";
  const path = (f) => "/api/institution/tenants/" + f.tenant.slug + "/evaluations";
  const post = (f, tail, body) =>
    request(app.getHttpServer())
      .post(path(f) + tail)
      .set("Cookie", f.cookie)
      .set("Origin", origin)
      .set("X-DoggyCredit-Institution", "1")
      .send(body);
  const get = (f, tail) =>
    request(app.getHttpServer())
      .get(path(f) + tail)
      .set("Cookie", f.cookie);
  const person = { firstName: "María", lastName: "Rojas", birthDate: "1998-07-14", phone: "71234567" };
  const input = (number = "9988776") => ({
    documentType: "CI",
    documentNumber: number,
    person,
    purpose: "WORKING_CAPITAL",
    requestedAmount: "12000.00",
    consent: true,
    idempotencyKey: randomUUID(),
  });
  async function fixture(ready = true, role = "ANALYST") {
    const suffix = randomUUID();
    const tenant = await db.tenant.create({
      data: {
        slug: "hu10-" + suffix,
        legalName: "Banco Demo",
        taxId: suffix,
        institutionType: "BANK",
        informationConfirmedAt: ready ? new Date() : null,
        productsConfirmedAt: ready ? new Date() : null,
      },
    });
    const user = await db.user.create({
      data: { email: suffix + "@example.test", fullName: "Carlos Pérez", passwordHash, status: "ACTIVE" },
    });
    const membership = await db.tenantMembership.create({
      data: { tenantId: tenant.id, userId: user.id, role, status: "ACTIVE" },
    });
    if (ready) {
      await db.tenantIntegration.create({
        data: { tenantId: tenant.id, providerId: provider.id, enabled: true, status: "ACTIVE" },
      });
      await db.financialProduct.create({
        data: {
          tenantId: tenant.id,
          name: "Producto",
          category: "MICRO_CREDIT",
          applicantScope: "PERSON",
          minAmount: "1",
          maxAmount: "50000",
          active: true,
        },
      });
    }
    const login = await request(app.getHttpServer())
      .post("/api/institution/auth/login")
      .set("Origin", origin)
      .set("X-DoggyCredit-Institution", "1")
      .send({ email: user.email, password })
      .expect(200);
    return { tenant, user, membership, cookie: login.headers["set-cookie"][0] };
  }
  before(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailSender)
      .useValue({
        send: async () => {
          throw new Error("HU10 must not send emails");
        },
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(app);
    await app.init();
    db = app.get(PrismaService);
    passwordHash = await hashPassword(password);
    provider = await db.integrationProvider.upsert({
      where: { code: "BANK_MOCK" },
      update: { status: "ACTIVE" },
      create: { code: "BANK_MOCK", name: "Bank Mock", kind: "BANK", status: "ACTIVE" },
    });
    x = await fixture();
    y = await fixture();
    notReady = await fixture(false);
    admin = await fixture(true, "INSTITUTION_ADMIN");
  });
  after(async () => app?.close());
  it("rolls back a new applicant and evaluation if audit persistence fails", async () => {
    const audit = app.get(AuditWriter);
    const original = audit.recordEvaluationPrepared;
    audit.recordEvaluationPrepared = async () => {
      throw new Error("simulated audit failure");
    };
    try {
      await post(x, "", input("6655449")).expect(500);
      assert.equal(await db.client.count({ where: { tenantId: x.tenant.id, documentNumber: "6655449" } }), 0);
    } finally {
      audit.recordEvaluationPrepared = original;
    }
  });
  it("PA-10.1 reuses a recognized local person and freezes the snapshot", async () => {
    const client = await db.client.create({
      data: {
        tenantId: x.tenant.id,
        type: "PERSON",
        documentType: "CI",
        documentNumber: "7812456",
        name: "María Fernanda Rojas",
        firstName: "María Fernanda",
        lastName: "Rojas",
        birthDate: new Date("1998-07-14"),
        phone: "71234567",
      },
    });
    const lookup = await post(x, "/lookup", { documentType: "CI", documentNumber: "7812456" }).expect(200);
    assert.equal(lookup.body.applicant.name, client.name);
    assert.equal(lookup.body.applicant.phone, undefined);
    const body = input("7812456");
    delete body.person;
    body.clientId = client.id;
    const response = await post(x, "", body).expect(201);
    const row = await db.evaluation.findUniqueOrThrow({ where: { id: response.body.id } });
    assert.equal(row.clientId, client.id);
    assert.equal(row.tenantId, x.tenant.id);
    assert.equal(row.createdByMembershipId, x.membership.id);
    assert.equal(row.status, "DRAFT");
    assert.ok(row.consentGivenAt);
    assert.equal(row.startedAt, null);
    await db.client.update({ where: { id: client.id }, data: { phone: "79999999" } });
    const recovered = await get(x, "/" + row.id).expect(200);
    assert.equal(recovered.body.applicantSnapshot.phone, "71234567");
    assert.equal(await db.auditLog.count({ where: { entityId: row.id, action: "EVALUATION_PREPARED" } }), 1);
  });
  it("PA-10.2 creates minimal Client only on final confirmation and keeps foreign documents isolated", async () => {
    await post(x, "/lookup", { documentType: "CI", documentNumber: "9988776" })
      .expect(200)
      .expect((r) => assert.equal(r.body.found, false));
    assert.equal(await db.client.count({ where: { tenantId: x.tenant.id, documentNumber: "9988776" } }), 0);
    const result = await post(x, "", input()).expect(201);
    const row = await db.evaluation.findUniqueOrThrow({ where: { id: result.body.id } });
    const client = await db.client.findUniqueOrThrow({ where: { id: row.clientId } });
    assert.equal(client.firstName, person.firstName);
    assert.equal(client.birthDate.toISOString().slice(0, 10), person.birthDate);
    await post(y, "", input()).expect(201);
    assert.equal(await db.client.count({ where: { documentType: "CI", documentNumber: "9988776" } }), 2);
  });
  it("PA-10.3/5 validates document, names, date, phone, purpose, amount and consent without writes", async () => {
    const before = await db.evaluation.count();
    for (const patch of [
      { documentType: "INVALID" },
      { documentNumber: "12A-??" },
      { person: { ...person, firstName: "" } },
      { person: { ...person, lastName: "Rojas1" } },
      { person: { ...person, birthDate: "2026-02-31" } },
      { person: { ...person, birthDate: "2999-01-01" } },
      { person: { ...person, phone: "abc123" } },
      { purpose: "CAR" },
      { requestedAmount: "0" },
      { requestedAmount: "-1" },
      { requestedAmount: "1.123" },
      { consent: false },
      { consent: "true" },
      { tenantId: y.tenant.id },
    ])
      await post(x, "", { ...input("5544332"), ...patch }).expect(400);
    assert.equal(await db.evaluation.count(), before);
    assert.equal(await db.client.count({ where: { documentNumber: "5544332" } }), 0);
  });
  it("PA-10.6 blocks early and rechecks readiness on final submission", async () => {
    assert.equal((await get(notReady, "/preparation").expect(200)).body.ready, false);
    await post(notReady, "/lookup", { documentType: "CI", documentNumber: "1234567" }).expect(409);
    await post(notReady, "", input()).expect(409);
    const fresh = await fixture();
    assert.equal((await get(fresh, "/preparation").expect(200)).body.ready, true);
    await db.tenant.update({ where: { id: fresh.tenant.id }, data: { productsConfirmedAt: null } });
    await post(fresh, "", input()).expect(409);
    assert.equal(await db.client.count({ where: { tenantId: fresh.tenant.id } }), 0);
  });
  it("PA-10.7 rejects foreign client IDs, evaluation IDs, slugs, inactive memberships and admin roles", async () => {
    const foreign = await post(y, "", input("8899001")).expect(201);
    const foreignRow = await db.evaluation.findUniqueOrThrow({ where: { id: foreign.body.id } });
    const localLookup = await post(x, "/lookup", { documentType: "CI", documentNumber: "8899001" }).expect(
      200,
    );
    assert.deepEqual(localLookup.body, { found: false, applicant: null });
    const tampered = input("8899001");
    delete tampered.person;
    tampered.clientId = foreignRow.clientId;
    await post(x, "", tampered).expect(404);
    await get(x, "/" + foreign.body.id).expect(404);
    await request(app.getHttpServer())
      .get(path(y) + "/preparation")
      .set("Cookie", x.cookie)
      .expect(403);
    await get(admin, "/preparation").expect(403);
    await post(admin, "", input()).expect(403);
    const suspended = await fixture();
    await db.tenantMembership.update({
      where: { id: suspended.membership.id },
      data: { status: "SUSPENDED" },
    });
    await get(suspended, "/preparation").expect(403);
  });
  it("serializes simultaneous submits, resolves client races and rejects changed idempotent payloads", async () => {
    const body = input("6655443");
    const responses = await Promise.all([post(x, "", body).expect(201), post(x, "", body).expect(201)]);
    assert.equal(responses[0].body.id, responses[1].body.id);
    assert.equal(await db.evaluation.count({ where: { idempotencyKey: body.idempotencyKey } }), 1);
    await post(x, "", { ...body, requestedAmount: "13000.00" }).expect(409);
    await post(y, "", body).expect(409);
    await Promise.all([post(x, "", input("6655444")).expect(201), post(x, "", input("6655444")).expect(201)]);
    assert.equal(await db.client.count({ where: { tenantId: x.tenant.id, documentNumber: "6655444" } }), 1);
    assert.equal(await db.evaluationSourceResult.count(), 0);
    assert.equal(await db.financialProfile.count(), 0);
    assert.equal(await db.evaluationRecommendation.count(), 0);
  });
});
