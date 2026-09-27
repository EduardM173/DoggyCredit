import assert from "node:assert/strict";
import { randomUUID, randomInt } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../dist/app.module.js";
import { configureApplication } from "../dist/common/configure-application.js";
import { PrismaService } from "../dist/infrastructure/prisma/prisma.service.js";
import { EmailSender } from "../dist/infrastructure/email/email-sender.js";

describe("HU-01 institution requests (PostgreSQL)", () => {
  let app;
  let prisma;
  const run = `HU01-E2E-${randomUUID()}`;
  const payload = (overrides = {}) => ({
    institutionName: run,
    taxId: `${Date.now()}${randomInt(100000, 999999)}`,
    institutionType: "BANK",
    planInterest: "UNSURE",
    contactName: "Ana Prueba",
    contactRole: "Representante",
    contactEmail: `${randomUUID()}@example.test`,
    contactPhone: "+59171234567",
    representsInstitution: true,
    acceptsTerms: true,
    ...overrides,
  });
  const post = (body) => request(app.getHttpServer()).post("/api/institution-requests").send(body);

  before(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailSender)
      .useValue({ send: async () => {} })
      .compile();
    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
  });
  after(async () => {
    try {
      if (prisma) await prisma.institutionRequest.deleteMany({ where: { institutionName: run } });
    } finally {
      await app?.close();
    }
  });

  it("persists normalized data with EMAIL_PENDING and creates no downstream entities", async () => {
    const input = payload();
    const response = await post({
      ...input,
      institutionName: `  ${run}  `,
      taxId: ` ${input.taxId.slice(0, 5)}-${input.taxId.slice(5)} `,
      contactName: " Ana Prueba ",
      contactRole: " Representante ",
      contactEmail: ` ${input.contactEmail.toUpperCase()} `,
      contactPhone: "+591 (712) 34-567",
    }).expect(201);
    assert.deepEqual(Object.keys(response.body).sort(), [
      "contactEmail",
      "emailDelivery",
      "id",
      "retryAfterSeconds",
      "status",
    ]);
    assert.equal(response.body.emailDelivery, "SENT");
    assert.equal(response.body.status, "EMAIL_PENDING");
    assert.equal(response.body.contactEmail, input.contactEmail);
    const saved = await prisma.institutionRequest.findUniqueOrThrow({ where: { id: response.body.id } });
    for (const key of [
      "institutionName",
      "taxId",
      "contactName",
      "contactRole",
      "contactEmail",
      "contactPhone",
      "institutionType",
      "planInterest",
    ])
      assert.equal(saved[key], input[key]);
    assert.equal(saved.status, "EMAIL_PENDING");
    assert.equal(saved.requestedPlanId, null);
    assert.equal(saved.emailVerifiedAt, null);
    assert.equal(saved.reviewedAt, null);
    assert.equal(await prisma.emailVerificationToken.count({ where: { requestId: saved.id } }), 1);
    assert.equal(await prisma.tenant.count({ where: { createdFromRequestId: saved.id } }), 0);
    assert.equal(await prisma.user.count({ where: { email: input.contactEmail } }), 0);
  });

  for (const field of [
    "institutionName",
    "taxId",
    "institutionType",
    "planInterest",
    "contactName",
    "contactRole",
    "contactEmail",
    "contactPhone",
    "representsInstitution",
    "acceptsTerms",
  ]) {
    it(`rejects a missing ${field}`, async () => {
      const input = payload();
      delete input[field];
      await post(input).expect(400);
    });
  }
  for (const [field, value] of [
    ["institutionName", "   "],
    ["contactName", "   "],
    ["contactRole", "   "],
    ["contactEmail", "not-an-email"],
    ["taxId", "abc!"],
    ["taxId", "---"],
    ["institutionType", "UNKNOWN"],
    ["planInterest", "PREMIUM"],
    ["contactPhone", "123"],
    ["contactPhone", "+591hello71234567"],
    ["institutionName", "x".repeat(181)],
    ["acceptsTerms", false],
    ["representsInstitution", "true"],
    ["taxId", 123],
  ]) {
    it(`rejects invalid ${field}: ${String(value).slice(0, 24)}`, async () => {
      await post(payload({ [field]: value })).expect(400);
    });
  }
  for (const field of [
    "status",
    "id",
    "createdAt",
    "updatedAt",
    "reviewedById",
    "requestedPlanId",
    "emailVerifiedAt",
  ]) {
    it(`does not accept client-controlled ${field}`, async () => {
      const beforeCount = await prisma.institutionRequest.count({ where: { institutionName: run } });
      await post(payload({ [field]: "APPROVED" })).expect(400);
      assert.equal(await prisma.institutionRequest.count({ where: { institutionName: run } }), beforeCount);
    });
  }

  it("rejects normalized duplicate NIT and email independently", async () => {
    const input = payload();
    await post(input).expect(201);
    await post(payload({ taxId: ` ${input.taxId.slice(0, 5)}-${input.taxId.slice(5)} ` })).expect(409);
    await post(payload({ contactEmail: ` ${input.contactEmail.toUpperCase()} ` })).expect(409);
  });
  for (const field of ["taxId", "contactEmail"]) {
    it(`serializes concurrent submissions sharing ${field}`, async () => {
      const input = payload();
      const responses = await Promise.all([post(input), post(payload({ [field]: input[field] }))]);
      assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
      assert.equal(await prisma.institutionRequest.count({ where: { [field]: input[field] } }), 1);
    });
  }
  it("documents the endpoint and validates a public plan of interest", async () => {
    const response = await request(app.getHttpServer()).get("/api/docs-json").expect(200);
    assert.ok(response.body.paths["/api/institution-requests"].post);
    assert.ok(response.body.paths["/api/public/plans"].get);
    await post(payload({ planInterest: "NOT_A_PUBLIC_PLAN" })).expect(400);
    const catalog = await request(app.getHttpServer()).get("/api/public/plans").expect(200);
    assert.ok(catalog.body.every((plan) => plan.code && plan.name && plan.price && plan.currency));
  });
});
