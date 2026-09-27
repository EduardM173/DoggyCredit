import assert from "node:assert/strict";
import { URL } from "node:url";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../dist/app.module.js";
import { configureApplication } from "../dist/common/configure-application.js";
import { PrismaService } from "../dist/infrastructure/prisma/prisma.service.js";
import { EmailSender } from "../dist/infrastructure/email/email-sender.js";

describe("HU-02 verification (PostgreSQL, fake EmailSender)", () => {
  let app, prisma;
  let messages = [],
    fail = false,
    hook;
  const run = `HU02-E2E-${randomUUID()}`;
  const sender = {
    async send(message) {
      messages.push(message);
      if (hook) await hook(message);
      if (fail) throw new Error("Simulated provider failure");
    },
  };
  const endpoint = "/api/institution-requests/email-verification";
  const post = (url, body) => request(app.getHttpServer()).post(url).send(body);
  const verify = (token) => post(`${endpoint}/verify`, { token });
  const resend = (requestId) => post(`${endpoint}/resend`, { requestId });
  const tokenOf = (message) =>
    new URL(message.text.split("\n").find((line) => line.startsWith("http"))).searchParams.get("token");
  const hash = (token) => createHash("sha256").update(token).digest("hex");
  const create = async () => {
    const response = await post("/api/institution-requests", {
      institutionName: run,
      taxId: `${Date.now()}${randomInt(100000, 999999)}`,
      institutionType: "BANK",
      planInterest: "UNSURE",
      contactName: "Ana Prueba",
      contactRole: "Gerente",
      contactEmail: `${randomUUID()}@example.test`,
      contactPhone: "+59171234567",
      representsInstitution: true,
      acceptsTerms: true,
    }).expect(201);
    return { receipt: response.body, token: tokenOf(messages.at(-1)) };
  };
  const expireCooldown = (requestId) =>
    prisma.emailVerificationToken.updateMany({
      where: { requestId },
      data: { createdAt: new Date(Date.now() - 172800000), sentAt: new Date(Date.now() - 172800000) },
    });
  const pending = async (id) => {
    const saved = await prisma.institutionRequest.findUniqueOrThrow({ where: { id } });
    assert.equal(saved.status, "EMAIL_PENDING");
    assert.equal(saved.emailVerifiedAt, null);
  };
  before(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailSender)
      .useValue(sender)
      .compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
  });
  beforeEach(() => {
    messages = [];
    fail = false;
    hook = undefined;
  });
  after(async () => {
    try {
      await prisma?.institutionRequest.deleteMany({ where: { institutionName: run } });
    } finally {
      await app?.close();
    }
  });

  it("creates a secure hash, sends the configured link and returns no token", async () => {
    const { receipt, token } = await create();
    assert.equal(receipt.emailDelivery, "SENT");
    assert.ok(receipt.retryAfterSeconds > 0);
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const saved = await prisma.emailVerificationToken.findUniqueOrThrow({
      where: { tokenHash: hash(token) },
    });
    assert.equal(saved.requestId, receipt.id);
    assert.ok(saved.sentAt);
    assert.equal(saved.usedAt, null);
    assert.equal(saved.invalidatedAt, null);
    assert.ok(saved.expiresAt > saved.createdAt);
    assert.equal(JSON.stringify(saved).includes(token), false);
    assert.equal(JSON.stringify(receipt).includes(token), false);
    assert.equal("tokenHash" in receipt, false);
    assert.equal(messages.length, 1);
    assert.match(messages[0].html, /Confirmar correo/);
    assert.equal(messages[0].idempotencyKey, `institution-request-verification/${receipt.id}/${saved.id}`);
    assert.equal(new URL(messages[0].text.split("\n")[2]).searchParams.get("requestId"), receipt.id);
    await pending(receipt.id);
  });
  it("consumes a valid token atomically without provisioning", async () => {
    const { receipt, token } = await create();
    const response = await verify(token).expect(200);
    assert.deepEqual(response.body, { contactEmail: receipt.contactEmail, status: "PENDING_REVIEW" });
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["referrer-policy"], "no-referrer");
    const saved = await prisma.institutionRequest.findUniqueOrThrow({ where: { id: receipt.id } });
    const used = await prisma.emailVerificationToken.findUniqueOrThrow({ where: { tokenHash: hash(token) } });
    assert.equal(saved.status, "PENDING_REVIEW");
    assert.ok(saved.emailVerifiedAt);
    assert.ok(used.usedAt);
    assert.equal(await prisma.tenant.count({ where: { createdFromRequestId: receipt.id } }), 0);
    assert.equal(await prisma.user.count({ where: { email: receipt.contactEmail } }), 0);
    assert.equal(saved.requestedPlanId, null);
    assert.equal(
      await prisma.tenantMembership.count({ where: { user: { email: receipt.contactEmail } } }),
      0,
    );
  });
  for (const scenario of ["unknown", "tampered", "expired", "used", "invalidated", "not sent"]) {
    it(`rejects ${scenario} tokens without modifying the request`, async () => {
      const { receipt, token } = await create();
      let input = token;
      const fields = {
        expired: { expiresAt: new Date(Date.now() - 1000) },
        used: { usedAt: new Date() },
        invalidated: { invalidatedAt: new Date() },
        "not sent": { sentAt: null },
      };
      if (fields[scenario])
        await prisma.emailVerificationToken.update({
          where: { tokenHash: hash(token) },
          data: fields[scenario],
        });
      else
        input =
          scenario === "unknown"
            ? randomBytes(32).toString("base64url")
            : (token[0] === "a" ? "b" : "a") + token.slice(1);
      await verify(input).expect(400);
      await pending(receipt.id);
    });
  }
  it("cannot reuse a successfully consumed token", async () => {
    const { token } = await create();
    await verify(token).expect(200);
    await verify(token).expect(400);
  });
  it("allows only one of two concurrent verifications", async () => {
    const { token } = await create();
    const responses = await Promise.all([verify(token), verify(token)]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
  });
  it("persists cooldown, sends Retry-After and creates no extra token/email", async () => {
    const { receipt } = await create();
    const result = await resend(receipt.id).expect(429);
    assert.ok(Number(result.headers["retry-after"]) > 0);
    assert.equal(Number(result.headers["retry-after"]), result.body.retryAfterSeconds);
    assert.equal(messages.length, 1);
    assert.equal(await prisma.emailVerificationToken.count({ where: { requestId: receipt.id } }), 1);
  });
  it("sends a new token and invalidates the previous one only on success", async () => {
    const { receipt, token } = await create();
    await expireCooldown(receipt.id);
    hook = async () => {
      const old = await prisma.emailVerificationToken.findUniqueOrThrow({
        where: { tokenHash: hash(token) },
      });
      assert.equal(old.invalidatedAt, null);
    };
    const result = await resend(receipt.id).expect(200);
    assert.equal(result.body.emailDelivery, "SENT");
    const next = tokenOf(messages.at(-1));
    assert.notEqual(next, token);
    assert.notEqual(messages[0].idempotencyKey, messages[1].idempotencyKey);
    await verify(token).expect(400);
    await verify(next).expect(200);
  });
  it("serializes simultaneous resends", async () => {
    const { receipt } = await create();
    await expireCooldown(receipt.id);
    const responses = await Promise.all([resend(receipt.id), resend(receipt.id)]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 429]);
    assert.equal(messages.length, 2);
  });
  for (const status of ["PENDING_REVIEW", "APPROVED", "REJECTED"]) {
    it(`never sends for ${status}`, async () => {
      const { receipt } = await create();
      await prisma.institutionRequest.update({ where: { id: receipt.id }, data: { status } });
      const result = await resend(receipt.id).expect(200);
      assert.deepEqual(result.body, { emailDelivery: "UNAVAILABLE", retryAfterSeconds: 0 });
      assert.equal(messages.length, 1);
    });
  }
  it("unknown references return no identity or detailed status", async () => {
    const result = await resend(randomUUID()).expect(200);
    assert.deepEqual(result.body, { emailDelivery: "UNAVAILABLE", retryAfterSeconds: 0 });
    assert.equal(messages.length, 0);
  });
  it("first send failure preserves the receipt and allows a later retry", async () => {
    fail = true;
    const { receipt, token } = await create();
    assert.equal(receipt.emailDelivery, "FAILED");
    await pending(receipt.id);
    await verify(token).expect(400);
    await resend(receipt.id).expect(429);
    // Advance the persisted attempt timestamp, not the token's delivery state.
    await prisma.emailVerificationToken.updateMany({
      where: { requestId: receipt.id },
      data: { createdAt: new Date(Date.now() - 172800000) },
    });
    fail = false;
    const result = await resend(receipt.id).expect(200);
    assert.equal(result.body.emailDelivery, "SENT");
    await verify(tokenOf(messages.at(-1))).expect(200);
    assert.equal(await prisma.institutionRequest.count({ where: { id: receipt.id } }), 1);
  });
  it("failed resend preserves a previous usable token", async () => {
    const { receipt, token } = await create();
    await expireCooldown(receipt.id);
    fail = true;
    const result = await resend(receipt.id).expect(200);
    assert.equal(result.body.emailDelivery, "FAILED");
    await pending(receipt.id);
    await verify(tokenOf(messages.at(-1))).expect(400);
    await verify(token).expect(200);
  });
  it("verification can finish while an external resend is in flight", async () => {
    const { receipt, token } = await create();
    await expireCooldown(receipt.id);
    hook = async () => {
      await verify(token).expect(200);
    };
    const result = await resend(receipt.id).expect(200);
    assert.equal(result.body.emailDelivery, "UNAVAILABLE");
    await verify(tokenOf(messages.at(-1))).expect(400);
  });
  it("an abandoned reservation cannot activate after a newer operation", async () => {
    const { receipt } = await create();
    await expireCooldown(receipt.id);
    let release, entered;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    hook = async () => {
      hook = undefined;
      entered();
      await gate;
    };
    const first = resend(receipt.id).then((r) => r);
    await started;
    await prisma.emailVerificationToken.updateMany({
      where: { requestId: receipt.id, sentAt: null },
      data: { createdAt: new Date(Date.now() - 86400000) },
    });
    // Move the old sent token further into the past so the reservation is the latest attempt.
    const second = await resend(receipt.id).expect(200);
    assert.equal(second.body.emailDelivery, "SENT");
    release();
    const late = await first;
    assert.equal(late.body.emailDelivery, "UNAVAILABLE");
    await verify(tokenOf(messages.at(-1))).expect(200);
  });
  it("rejects malformed DTOs without echoing tokens in paths", async () => {
    await verify("bad").expect(400);
    await resend("123").expect(400);
    const result = await post(`${endpoint}/verify?token=not-for-response`, { token: "bad" }).expect(400);
    assert.equal(JSON.stringify(result.body).includes("not-for-response"), false);
    await post(`${endpoint}/verify`, {
      token: randomBytes(32).toString("base64url"),
      status: "APPROVED",
    }).expect(400);
  });
});
