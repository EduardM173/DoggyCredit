import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { URL, URLSearchParams } from "node:url";
import { before, after, describe, it } from "node:test";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import request from "supertest";
import { AppModule } from "../dist/app.module.js";
import { configureApplication } from "../dist/common/configure-application.js";
import { PrismaService } from "../dist/infrastructure/prisma/prisma.service.js";
import { EmailSender } from "../dist/infrastructure/email/email-sender.js";
import { PaymentProvider } from "../dist/infrastructure/payments/payment-provider.js";
import { PaymentEventProcessor } from "../dist/plans-metering/payment-event-processor.js";
import { AuditWriter } from "../dist/audit/public.js";

describe("HU-04 contracting and mock provider (PostgreSQL)", () => {
  let app, prisma, config, operator, admin, origin, free, paid, inactive, privatePlan, provider, processor;
  const run = `HU04-${randomUUID()}`;
  const requestIds = [];
  const hashes = [];
  const digest = (token) => createHash("sha256").update(token).digest("hex");
  const get = (url, cookie) =>
    request(app.getHttpServer())
      .get(`/api${url}`)
      .set("Cookie", cookie ?? "");
  const post = (url, body = {}, cookie = admin) =>
    request(app.getHttpServer())
      .post(`/api${url}`)
      .set("Origin", origin)
      .set("X-DoggyCredit-Admin", "1")
      .set("Cookie", cookie ?? "")
      .send(body);
  const make = async (status = "APPROVED") => {
    const row = await prisma.institutionRequest.create({
      data: {
        institutionName: run,
        taxId: randomUUID(),
        institutionType: "BANK",
        contactName: "Test representative",
        contactRole: "Manager",
        contactEmail: `${randomUUID()}@example.test`,
        planInterest: "UNSURE",
        status,
        emailVerifiedAt: status === "EMAIL_PENDING" ? null : new Date(),
      },
    });
    requestIds.push(row.id);
    return row;
  };
  const issue = async (id) => {
    const r = await post(`/admin/institution-requests/${id}/contracting-access`).expect(200);
    const token = new URLSearchParams(new URL(r.body.url).hash.slice(1)).get("token");
    hashes.push(token);
    return token;
  };
  const exchange = async (token) => {
    const r = await post("/contracting/access", { token }, "").expect(200);
    assert.match(r.headers["set-cookie"][0], /HttpOnly/);
    assert.match(r.headers["set-cookie"][0], /SameSite=Strict/);
    return r.headers["set-cookie"][0].split(";")[0];
  };
  const context = async () => {
    const row = await make();
    const token = await issue(row.id);
    return { row, token, cookie: await exchange(token) };
  };
  const plan = async (c, selected = paid) =>
    (await post("/contracting/plan", { planId: selected.id }, c.cookie).expect(200)).body;
  const payment = async (c, method = "QR", key = randomUUID()) =>
    (await post("/contracting/payment", { method }, c.cookie).set("Idempotency-Key", key).expect(200)).body
      .contracting.payment;
  const checkout = async (c) => {
    const r = await post("/contracting/payment/checkout", {}, c.cookie).expect(200);
    const token = new URLSearchParams(new URL(r.body.checkoutUrl).hash.slice(1)).get("token");
    hashes.push(token);
    return token;
  };
  const result = (token, value) =>
    post("/mock-payment-provider/checkout/result", { result: value }, "").set("X-DoggyPay-Token", token);
  const eventOf = (p, type = "PAYMENT_SUCCEEDED") => ({
    provider: "mock",
    eventId: randomUUID(),
    providerReference: `mock_${p.id}`,
    type,
    amount: p.amount,
    currency: p.currency,
    occurredAt: new Date(),
  });
  before(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailSender)
      .useValue({ send: async () => {} })
      .compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    config = app.get(ConfigService);
    config.set("PAYMENT_PROVIDER", "mock");
    origin = new URL(config.getOrThrow("WEB_ORIGIN")).origin;
    provider = app.get(PaymentProvider);
    processor = app.get(PaymentEventProcessor);
    operator = await prisma.user.create({
      data: {
        email: `${run}@example.test`.toLowerCase(),
        fullName: run,
        platformRole: "OPERATOR",
        status: "ACTIVE",
      },
    });
    const token = randomBytes(32).toString("base64url");
    await prisma.adminSession.create({
      data: { userId: operator.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 3600000) },
    });
    admin = `doggycredit_admin=${token}`;
    free = await prisma.plan.create({
      data: {
        code: `F-${run}`,
        isPublic: true,
        name: "Free test",
        price: "0",
        currency: "BOB",
        billingPeriod: "MONTHLY",
        requiresPayment: false,
        features: ["Demo"],
      },
    });
    paid = await prisma.plan.create({
      data: {
        code: `P-${run}`,
        isPublic: true,
        name: "Paid test",
        price: "349",
        currency: "BOB",
        billingPeriod: "MONTHLY",
        requiresPayment: true,
      },
    });
    inactive = await prisma.plan.create({
      data: {
        code: `I-${run}`,
        name: "Inactive test",
        price: "10",
        currency: "BOB",
        billingPeriod: "MONTHLY",
        requiresPayment: true,
        active: false,
      },
    });
    privatePlan = await prisma.plan.create({
      data: {
        code: `H-${run}`,
        name: "Internal only",
        price: "500",
        currency: "BOB",
        billingPeriod: "MONTHLY",
        requiresPayment: true,
      },
    });
  });
  after(async () => {
    try {
      if (prisma) {
        const contracts = await prisma.contracting.findMany({
          where: { requestId: { in: requestIds } },
          select: { id: true },
        });
        const cids = contracts.map((r) => r.id);
        const payments = await prisma.payment.findMany({
          where: { contractingId: { in: cids } },
          select: { id: true, providerReference: true },
        });
        const refs = payments.map((p) => `mock_${p.id}`);
        await prisma.auditLog.deleteMany({
          where: { entityId: { in: [...requestIds, ...cids, ...payments.map((p) => p.id)] } },
        });
        await prisma.paymentProviderEvent.deleteMany({ where: { providerReference: { in: refs } } });
        await prisma.mockPaymentCheckout.deleteMany({ where: { providerReference: { in: refs } } });
        await prisma.payment.deleteMany({ where: { contractingId: { in: cids } } });
        await prisma.contracting.deleteMany({ where: { id: { in: cids } } });
        await prisma.institutionRequest.deleteMany({ where: { id: { in: requestIds } } });
        await prisma.plan.deleteMany({
          where: { id: { in: [free?.id, paid?.id, inactive?.id, privatePlan?.id].filter(Boolean) } },
        });
        if (operator) await prisma.user.delete({ where: { id: operator.id } });
      }
    } finally {
      await app?.close();
    }
  });
  for (const status of ["EMAIL_PENDING", "PENDING_REVIEW", "REJECTED"])
    it(`${status} cannot obtain contracting access`, async () => {
      const row = await make(status);
      await post(`/admin/institution-requests/${row.id}/contracting-access`).expect(409);
      assert.equal(await prisma.contractingCredential.count({ where: { requestId: row.id } }), 0);
    });
  it("shows only public active offers and never confirms a private plan", async () => {
    const catalog = await get("/public/plans").expect(200);
    assert.ok(catalog.body.some((plan) => plan.code === free.code));
    assert.ok(catalog.body.some((plan) => plan.code === paid.code));
    assert.ok(!catalog.body.some((plan) => [privatePlan.code, inactive.code].includes(plan.code)));
    const c = await context();
    const view = await get("/contracting/context", c.cookie).expect(200);
    assert.deepEqual(
      view.body.plans.map((plan) => plan.code).sort(),
      catalog.body.map((plan) => plan.code).sort(),
    );
    await post("/contracting/plan", { planId: privatePlan.id }, c.cookie).expect(404);
  });
  it("APPROVED receives one-use high entropy hash-only bootstrap and scoped session", async () => {
    const c = await context();
    assert.match(c.token, /^[A-Za-z0-9_-]{43}$/);
    const access = await prisma.contractingCredential.findUniqueOrThrow({
      where: { tokenHash: digest(c.token) },
    });
    assert.ok(access.usedAt);
    assert.ok(!JSON.stringify(access).includes(c.token));
    await post("/contracting/access", { token: c.token }, "").expect(401);
    const view = await get("/contracting/context", c.cookie).expect(200);
    assert.equal(view.body.institution.id, c.row.id);
    assert.equal(view.body.institution.planInterest, "UNSURE");
    assert.doesNotMatch(JSON.stringify(view.body), /tokenHash|passwordHash|sessionToken/);
  });
  it("rejects invalid and expired bootstrap", async () => {
    await post("/contracting/access", { token: randomBytes(32).toString("base64url") }, "").expect(401);
    const row = await make();
    const token = await issue(row.id);
    await prisma.contractingCredential.updateMany({
      where: { requestId: row.id },
      data: { expiresAt: new Date(0) },
    });
    await post("/contracting/access", { token }, "").expect(401);
  });
  it("rotation invalidates old links and sessions", async () => {
    const c = await context();
    const first = await issue(c.row.id);
    const second = await issue(c.row.id);
    await post("/contracting/access", { token: first }, "").expect(401);
    await get("/contracting/context", c.cookie).expect(401);
    await exchange(second);
  });
  it("consumes concurrent bootstrap only once", async () => {
    const row = await make();
    const token = await issue(row.id);
    const responses = await Promise.all([
      post("/contracting/access", { token }, ""),
      post("/contracting/access", { token }, ""),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 401]);
  });
  it("requires scoped session and rejects cross-request identifiers", async () => {
    await get("/contracting/context", "").expect(401);
    const a = await context();
    const b = await context();
    await post("/contracting/plan", { planId: free.id, requestId: b.row.id }, a.cookie).expect(400);
    await plan(a, free);
    assert.equal(await prisma.contracting.count({ where: { requestId: b.row.id } }), 0);
  });
  it("checks approval again after bootstrap", async () => {
    const c = await context();
    await prisma.institutionRequest.update({ where: { id: c.row.id }, data: { status: "REJECTED" } });
    await post("/contracting/plan", { planId: free.id }, c.cookie).expect(409);
  });
  it("rejects unknown/inactive plans and client-supplied commercial terms", async () => {
    const c = await context();
    for (const id of [randomUUID(), inactive.id])
      await post("/contracting/plan", { planId: id }, c.cookie).expect(404);
    await post("/contracting/plan", { planId: paid.id, price: "1", currency: "USD" }, c.cookie).expect(400);
  });
  it("free plan confirms without Payment or provisioning and is idempotent", async () => {
    const c = await context();
    const counts = async () =>
      Promise.all([
        prisma.tenant.count(),
        prisma.tenantSubscription.count(),
        prisma.tenantMembership.count(),
        prisma.membershipInvitation.count(),
        prisma.user.count(),
      ]);
    const before = await counts();
    const responses = await Promise.all([
      post("/contracting/plan", { planId: free.id }, c.cookie),
      post("/contracting/plan", { planId: free.id }, c.cookie),
    ]);
    assert.ok(responses.every((r) => r.status === 200));
    const contract = responses[0].body.contracting;
    assert.equal(contract.status, "CONFIRMED");
    assert.ok(contract.confirmedAt);
    assert.equal(contract.payment, null);
    assert.equal(await prisma.contracting.count({ where: { requestId: c.row.id } }), 1);
    assert.equal(await prisma.payment.count({ where: { contractingId: contract.id } }), 0);
    assert.deepEqual(await counts(), before);
    assert.equal(
      await prisma.auditLog.count({ where: { entityId: contract.id, action: "CONTRACTING_CONFIRMED" } }),
      1,
    );
    await post("/contracting/payment", { method: "QR" }, c.cookie)
      .set("Idempotency-Key", randomUUID())
      .expect(409);
  });
  it("paid plan stores explicit Decimal snapshot and does not mutate planInterest", async () => {
    const c = await context();
    const view = await plan(c);
    assert.equal(view.contracting.price, "349.00");
    assert.equal(view.contracting.currency, "BOB");
    assert.equal(view.contracting.billingPeriod, "MONTHLY");
    assert.equal(view.contracting.status, "PENDING_PAYMENT");
    await prisma.plan.update({ where: { id: paid.id }, data: { price: "399" } });
    try {
      const current = await get("/contracting/context", c.cookie).expect(200);
      assert.equal(current.body.contracting.price, "349.00");
      assert.equal(current.body.institution.planInterest, "UNSURE");
    } finally {
      await prisma.plan.update({ where: { id: paid.id }, data: { price: "349" } });
    }
  });
  for (const method of ["BANK_TRANSFER", "QR", "CARD"])
    it(`${method} creates PENDING with server amount and stable idempotency`, async () => {
      const c = await context();
      await plan(c);
      const key = randomUUID();
      const a = await payment(c, method, key);
      const b = await payment(c, method, key);
      assert.equal(a.id, b.id);
      assert.equal(a.status, "PENDING");
      assert.equal(a.amount, "349.00");
      assert.equal(a.currency, "BOB");
      assert.equal(a.initialized, true);
      assert.equal(await prisma.payment.count({ where: { contracting: { requestId: c.row.id } } }), 1);
      assert.doesNotMatch(JSON.stringify(a), /cardNumber|cvv|tokenHash|providerReference/);
    });
  it("concurrent submissions with different keys preserve one pending attempt", async () => {
    const c = await context();
    await plan(c);
    const values = await Promise.all([payment(c), payment(c)]);
    assert.equal(values[0].id, values[1].id);
    await post("/contracting/payment", { method: "CARD" }, c.cookie)
      .set("Idempotency-Key", randomUUID())
      .expect(409);
  });
  it("rejects invalid methods, missing key and browser attempt to mark PAID", async () => {
    const c = await context();
    await plan(c);
    await post("/contracting/payment", { method: "CASH" }, c.cookie)
      .set("Idempotency-Key", randomUUID())
      .expect(400);
    await post("/contracting/payment", { method: "QR" }, c.cookie).expect(400);
    await post("/contracting/payment", { method: "QR", amount: "1", status: "PAID" }, c.cookie)
      .set("Idempotency-Key", randomUUID())
      .expect(400);
  });
  it("prevents changing terms after payment starts", async () => {
    const c = await context();
    await plan(c);
    await payment(c);
    await post("/contracting/plan", { planId: free.id }, c.cookie).expect(409);
  });
  it("initialization failure retains the same PENDING attempt for retry", async () => {
    const c = await context();
    await plan(c);
    const original = provider.createCheckout;
    provider.createCheckout = async () => {
      throw new Error("test unavailable");
    };
    const key = randomUUID();
    try {
      await post("/contracting/payment", { method: "QR" }, c.cookie).set("Idempotency-Key", key).expect(503);
    } finally {
      provider.createCheckout = original;
    }
    const before = await prisma.payment.findFirstOrThrow({ where: { contracting: { requestId: c.row.id } } });
    assert.equal(before.status, "PENDING");
    assert.equal(before.providerReference, null);
    const after = await payment(c, "QR", key);
    assert.equal(after.id, before.id);
  });
  it("checkout exposes minimal information and persists only token digest", async () => {
    const c = await context();
    await plan(c);
    const p = await payment(c);
    const token = await checkout(c);
    const row = await prisma.mockPaymentCheckout.findUniqueOrThrow({
      where: { providerReference: `mock_${p.id}` },
    });
    assert.equal(row.tokenHash, digest(token));
    assert.ok(!JSON.stringify(row).includes(token));
    const r = await get("/mock-payment-provider/checkout", "").set("X-DoggyPay-Token", token).expect(200);
    assert.equal(r.body.amount, "349.00");
    assert.doesNotMatch(JSON.stringify(r.body), /institution|contact|taxId|tokenHash|providerReference/i);
  });
  it("expired checkout cannot resolve and regeneration invalidates previous token on same Payment", async () => {
    const c = await context();
    await plan(c);
    const p = await payment(c);
    const old = await checkout(c);
    await prisma.mockPaymentCheckout.update({
      where: { providerReference: `mock_${p.id}` },
      data: { expiresAt: new Date(0) },
    });
    await result(old, "PAID").expect(410);
    const next = await checkout(c);
    assert.notEqual(next, old);
    await result(old, "PAID").expect(404);
    await result(next, "PAID").expect(200);
    assert.equal(await prisma.payment.count({ where: { contracting: { requestId: c.row.id } } }), 1);
  });
  for (const [value, expected] of [
    ["PAID", "CONFIRMED"],
    ["FAILED", "PENDING_PAYMENT"],
    ["CANCELLED", "PENDING_PAYMENT"],
  ])
    it(`mock result ${value} updates Payment and leaves contracting ${expected}`, async () => {
      const c = await context();
      await plan(c);
      const p = await payment(c, "CARD");
      const token = await checkout(c);
      await result(token, value).expect(200);
      const row = await prisma.payment.findUniqueOrThrow({
        where: { id: p.id },
        include: { contracting: true },
      });
      assert.equal(row.status, value);
      assert.equal(row.contracting.status, expected);
      assert.ok(row.paidAt ?? row.failedAt ?? row.cancelledAt);
      assert.equal(await prisma.auditLog.count({ where: { entityId: p.id, action: `PAYMENT_${value}` } }), 1);
      const status = await get("/contracting/payment/status", c.cookie).expect(200);
      assert.equal(status.body.payment.status, value);
      assert.doesNotMatch(JSON.stringify(status.body), /token|providerReference/i);
    });
  it("concurrent confirmation/cancellation has one terminal outcome and one business event", async () => {
    const c = await context();
    await plan(c);
    const p = await payment(c);
    const token = await checkout(c);
    const responses = await Promise.all([result(token, "PAID"), result(token, "CANCELLED")]);
    assert.ok(responses.every((r) => r.status === 200));
    assert.equal(responses[0].body.status, responses[1].body.status);
    assert.equal(
      await prisma.auditLog.count({
        where: { entityId: p.id, action: { in: ["PAYMENT_PAID", "PAYMENT_CANCELLED"] } },
      }),
      1,
    );
    await result(token, "FAILED").expect(200);
    assert.equal(await prisma.auditLog.count({ where: { entityId: p.id, action: "PAYMENT_FAILED" } }), 0);
  });
  it("deduplicates persisted provider event and rejects modified duplicate payload", async () => {
    const c = await context();
    await plan(c);
    const p = await payment(c);
    const event = eventOf(p);
    await processor.process(event);
    const repeated = await processor.process(event);
    assert.equal(repeated.duplicate, true);
    assert.equal(await prisma.paymentProviderEvent.count({ where: { eventId: event.eventId } }), 1);
    await assert.rejects(() => processor.process({ ...event, amount: "1.00" }));
  });
  for (const change of [
    { amount: "1.00" },
    { currency: "USD" },
    { providerReference: "mock_unknown" },
    { provider: "unknown" },
    { type: "INVALID" },
  ])
    it(`rejects event mismatch ${Object.keys(change)[0]}`, async () => {
      const c = await context();
      await plan(c);
      const p = await payment(c);
      await assert.rejects(() => processor.process({ ...eventOf(p), ...change }));
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status, "PENDING");
    });
  it("processing failure rolls back Payment, Contracting, Audit and event; retry replays provider result", async () => {
    const c = await context();
    await plan(c);
    const p = await payment(c);
    const token = await checkout(c);
    const audit = app.get(AuditWriter);
    const original = audit.recordCommerce;
    audit.recordCommerce = async function (e) {
      await original.call(this, e);
      if (e.action === "PAYMENT_PAID") throw new Error("intentional rollback");
    };
    try {
      await result(token, "PAID").expect(500);
    } finally {
      audit.recordCommerce = original;
    }
    assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status, "PENDING");
    assert.equal(
      await prisma.paymentProviderEvent.count({ where: { providerReference: `mock_${p.id}` } }),
      0,
    );
    assert.equal(await prisma.auditLog.count({ where: { entityId: p.id, action: "PAYMENT_PAID" } }), 0);
    await result(token, "PAID").expect(200);
  });
  for (const terminal of ["FAILED", "CANCELLED"])
    it(`${terminal} retry creates a new attempt and preserves old history`, async () => {
      const c = await context();
      await plan(c);
      const first = await payment(c);
      await result(await checkout(c), terminal).expect(200);
      const second = await payment(c);
      assert.notEqual(first.id, second.id);
      assert.notEqual(first.reference, second.reference);
      assert.equal((await prisma.payment.findUniqueOrThrow({ where: { id: first.id } })).status, terminal);
      await result(await checkout(c), "PAID").expect(200);
      await post("/contracting/payment", { method: "QR" }, c.cookie)
        .set("Idempotency-Key", randomUUID())
        .expect(409);
    });
  it("admin transfer simulation passes through provider event processor", async () => {
    const c = await context();
    await plan(c);
    const p = await payment(c, "BANK_TRANSFER");
    await post(`/admin/contractings/payments/${p.id}/simulate`, { result: "PAID" }).expect(200);
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
    assert.equal(row.status, "PAID");
    assert.equal(
      await prisma.paymentProviderEvent.count({ where: { providerReference: row.providerReference } }),
      1,
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: p.id, action: "PAYMENT_PAID" },
    });
    assert.equal(audit.actorUserId, operator.id);
    assert.equal(audit.metadata.actorKind, "PAYMENT_PROVIDER");
  });
  it("admin endpoints enforce 401/403 and CSRF", async () => {
    await get("/admin/contractings", "").expect(401);
    await prisma.user.update({ where: { id: operator.id }, data: { platformRole: null } });
    try {
      await get("/admin/contractings", admin).expect(403);
    } finally {
      await prisma.user.update({ where: { id: operator.id }, data: { platformRole: "OPERATOR" } });
    }
    await get("/admin/contractings", admin).expect(200);
    const c = await context();
    await request(app.getHttpServer())
      .post("/api/contracting/plan")
      .set("Cookie", c.cookie)
      .send({ planId: paid.id })
      .expect(403);
  });
  it("disabled provider hides all mock controls/endpoints", async () => {
    const c = await context();
    await plan(c);
    const p = await payment(c, "BANK_TRANSFER");
    config.set("PAYMENT_PROVIDER", "disabled");
    try {
      await get("/mock-payment-provider/checkout", "")
        .set("X-DoggyPay-Token", randomBytes(32).toString("base64url"))
        .expect(404);
      await post(`/admin/contractings/payments/${p.id}/simulate`, { result: "PAID" }).expect(404);
      const view = await get("/admin/contractings", admin).expect(200);
      assert.equal(view.body.paymentProvider, "disabled");
    } finally {
      config.set("PAYMENT_PROVIDER", "mock");
    }
  });
  it("audit never stores bootstrap/checkout tokens or secrets", async () => {
    const events = await prisma.auditLog.findMany({ where: { actorUserId: operator.id } });
    const json = JSON.stringify(events);
    for (const token of hashes) assert.equal(json.includes(token), false);
    assert.doesNotMatch(json, /tokenHash|passwordHash|cookie|cvv/i);
  });
});
