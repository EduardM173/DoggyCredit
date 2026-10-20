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

describe("HU-34 institution data", () => {
  let app, db;
  const origin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  const password = "Institucion segura 2026!";
  const api = (slug) => `/api/institution/tenants/${slug}/institution-data`;
  const get = (slug, cookie) =>
    request(app.getHttpServer())
      .get(api(slug))
      .set("Cookie", cookie)
      .set("Origin", origin)
      .set("X-DoggyCredit-Institution", "1");

  async function fixture(role = "INSTITUTION_ADMIN") {
    const suffix = randomUUID().slice(0, 8);
    const user = await db.user.create({
      data: {
        email: `hu34-${suffix}@example.test`,
        fullName: `Ana ${suffix}`,
        passwordHash: await hashPassword(password),
        status: "ACTIVE",
      },
    });
    const tenant = await db.tenant.create({
      data: {
        slug: `hu34-${suffix}`,
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

  it("lists editable and blocked fields with provenance, and persists authorized updates", async () => {
    const x = await fixture();
    const cookie = await x.login();

    const read = await get(x.tenant.slug, cookie).expect(200);
    assert.equal(read.body.tenantSlug, x.tenant.slug);
    assert.ok(read.body.supportMessage.includes("Soporte de Doggy Software"));
    for (const field of read.body.fields) assert.ok(field.provenance);

    const locked = read.body.fields.filter((field) => !field.editable).map((field) => field.key);
    assert.ok(locked.includes("taxId"));
    assert.ok(locked.includes("legalName"));
    assert.ok(locked.includes("tenantSlug"));
    assert.ok(locked.includes("contractualResponsible"));

    const updated = await request(app.getHttpServer())
      .patch(api(x.tenant.slug))
      .set("Cookie", cookie)
      .set("Origin", origin)
      .set("X-DoggyCredit-Institution", "1")
      .send({ publicAddress: "Calle 9 #9-9", contactPhone: "+57 300 111 2233" })
      .expect(200);
    const address = updated.body.fields.find((field) => field.key === "publicAddress");
    assert.equal(address.value, "Calle 9 #9-9");

    const persisted = await db.tenant.findUniqueOrThrow({ where: { id: x.tenant.id } });
    assert.equal(persisted.publicAddress, "Calle 9 #9-9");
    assert.equal(persisted.contactPhone, "+573001112233");
    assert.equal(
      await db.auditLog.count({
        where: { tenantId: x.tenant.id, action: "INSTITUTION_DATA_UPDATED" },
      }),
      1,
    );
  });

  it("rejects attempts to modify blocked fields instead of silently applying them", async () => {
    const x = await fixture();
    const cookie = await x.login();
    await request(app.getHttpServer())
      .patch(api(x.tenant.slug))
      .set("Cookie", cookie)
      .set("Origin", origin)
      .set("X-DoggyCredit-Institution", "1")
      .send({ taxId: "tampered", legalName: "Forzado" })
      .expect(400);
    const persisted = await db.tenant.findUniqueOrThrow({ where: { id: x.tenant.id } });
    assert.equal(persisted.taxId, x.tenant.taxId);
    assert.equal(persisted.legalName, x.tenant.legalName);
  });

  it("rejects invalid payloads and requests without authorized fields", async () => {
    const x = await fixture();
    const cookie = await x.login();
    await request(app.getHttpServer())
      .patch(api(x.tenant.slug))
      .set("Cookie", cookie)
      .set("Origin", origin)
      .set("X-DoggyCredit-Institution", "1")
      .send({ contactEmail: "no-es-un-correo" })
      .expect(400);
    await request(app.getHttpServer())
      .patch(api(x.tenant.slug))
      .set("Cookie", cookie)
      .set("Origin", origin)
      .set("X-DoggyCredit-Institution", "1")
      .send({})
      .expect(400);
  });

  it("enforces strict tenant isolation and role checks (CA-34.05)", async () => {
    const admin = await fixture();
    const other = await fixture();
    const analyst = await fixture("ANALYST");
    const adminCookie = await admin.login();

    await get(other.tenant.slug, adminCookie).expect(403);
    await request(app.getHttpServer())
      .patch(api(other.tenant.slug))
      .set("Cookie", adminCookie)
      .set("Origin", origin)
      .set("X-DoggyCredit-Institution", "1")
      .send({ publicAddress: "X" })
      .expect(403);

    const analystCookie = await analyst.login();
    await get(analyst.tenant.slug, analystCookie).expect(200);
    await request(app.getHttpServer())
      .patch(api(analyst.tenant.slug))
      .set("Cookie", analystCookie)
      .set("Origin", origin)
      .set("X-DoggyCredit-Institution", "1")
      .send({ publicAddress: "Forzado" })
      .expect(403);

    const otherTenant = await db.tenant.findUniqueOrThrow({ where: { id: other.tenant.id } });
    assert.equal(otherTenant.publicAddress, null);
  });

  it("requires an institutional origin header for updates", async () => {
    const x = await fixture();
    const cookie = await x.login();
    await request(app.getHttpServer())
      .patch(api(x.tenant.slug))
      .set("Cookie", cookie)
      .send({ publicAddress: "Calle 1" })
      .expect(403);
  });
});
