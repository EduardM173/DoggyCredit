import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { before, after, describe, it } from "node:test";
import request from "supertest";
import { Test } from "@nestjs/testing";
import { AppModule } from "../dist/app.module.js";
import { configureApplication } from "../dist/common/configure-application.js";
import { PrismaService } from "../dist/infrastructure/prisma/prisma.service.js";
import { EmailSender } from "../dist/infrastructure/email/email-sender.js";
import { AuditWriter } from "../dist/audit/public.js";
import { hashPassword, verifyPassword } from "../dist/identity-tenants/auth/password-hashing.js";

describe("HU-06 institution administrator activation", () => {
  let app, db;
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  const post = (route, body) =>
    request(app.getHttpServer()).post(`/api/membership-invitations/${route}`).send(body);
  const fixture = async (options = {}) => {
    const suffix = randomUUID().slice(0, 8);
    const user =
      options.user ??
      (await db.user.create({
        data: {
          email: `activation-${suffix}@example.test`,
          fullName: `Ana ${suffix}`,
          status: options.status ?? "INVITED",
          passwordHash: options.passwordHash ?? null,
          platformRole: options.platformRole ?? null,
        },
      }));
    const tenant = await db.tenant.create({
      data: {
        slug: `activation-${suffix}`,
        legalName: `Institución ${suffix}`,
        taxId: `act-${suffix}`,
        institutionType: "BANK",
        status: options.tenantStatus ?? "ACTIVE",
      },
    });
    const membership = await db.tenantMembership.create({
      data: {
        userId: user.id,
        tenantId: tenant.id,
        role: "INSTITUTION_ADMIN",
        status: options.membershipStatus ?? "INVITED",
        isInitialAdmin: true,
      },
    });
    const token = randomBytes(32).toString("base64url");
    const invitation = await db.membershipInvitation.create({
      data: {
        tenantId: tenant.id,
        membershipId: membership.id,
        tokenHash: digest(token),
        expiresAt: options.expiresAt ?? new Date(Date.now() + 3600000),
        sentAt: new Date(),
        acceptedAt: options.acceptedAt ?? null,
        invalidatedAt: options.invalidatedAt ?? null,
      },
    });
    return { user, tenant, membership, invitation, token };
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
  after(async () => {
    await app?.close();
  });

  it("preview returns real minimum context without consuming or exposing hashes", async () => {
    const f = await fixture();
    const res = await post("preview", { token: f.token }).expect(200);
    assert.equal(res.body.institution.name, f.tenant.legalName);
    assert.equal(res.body.invitedUser.email, f.user.email);
    assert.equal(res.body.requiresCredentialSetup, true);
    assert.equal(res.body.role, "INSTITUTION_ADMIN");
    assert.doesNotMatch(JSON.stringify(res.body), /passwordHash|tokenHash|tenantId|platformRole/);
    assert.equal(
      (await db.membershipInvitation.findUniqueOrThrow({ where: { id: f.invitation.id } })).acceptedAt,
      null,
    );
    assert.match(res.headers["cache-control"], /no-store/);
    assert.equal(res.headers["referrer-policy"], "no-referrer");
    assert.equal(
      (await request(app.getHttpServer()).get(`/api/membership-invitations/preview?token=${f.token}`)).status,
      404,
    );
  });
  it("rejects invalid, expired, used, invalidated, suspended and blocked invitations", async () => {
    await post("preview", { token: "not-a-token" }).expect(400);
    const states = [
      { expiresAt: new Date(0) },
      { acceptedAt: new Date() },
      { invalidatedAt: new Date() },
      { membershipStatus: "SUSPENDED" },
      { status: "BLOCKED" },
      { tenantStatus: "SUSPENDED" },
    ];
    for (const state of states) {
      const f = await fixture(state);
      await post("preview", { token: f.token }).expect(400);
      await post("activate", { token: f.token, password: "A valid long passphrase 42" }).expect(400);
      assert.equal(
        (await db.tenantMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).status,
        state.membershipStatus ?? "INVITED",
      );
    }
  });
  it("new user sets an NFC password and atomically activates only its membership", async () => {
    const f = await fixture();
    const password = "  una frase larga con cafe\u0301  ";
    const res = await post("activate", { token: f.token, password }).expect(200);
    assert.deepEqual(res.body, {
      activated: true,
      institution: { name: f.tenant.legalName, slug: f.tenant.slug },
      membershipStatus: "ACTIVE",
    });
    assert.doesNotMatch(JSON.stringify(res.body), /password|token|userId|tenantId/);
    const user = await db.user.findUniqueOrThrow({ where: { id: f.user.id } });
    assert.equal(user.status, "ACTIVE");
    assert.ok(await verifyPassword(user.passwordHash, password.normalize("NFC")));
    assert.equal(await verifyPassword(user.passwordHash, password.trim()), false);
    assert.equal(
      (await db.tenantMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).status,
      "ACTIVE",
    );
    assert.ok(
      (await db.membershipInvitation.findUniqueOrThrow({ where: { id: f.invitation.id } })).acceptedAt,
    );
    const audit = await db.auditLog.findMany({
      where: { entityId: f.membership.id, action: "MEMBERSHIP_ACTIVATED" },
    });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actorUserId, f.user.id);
    assert.equal(audit[0].tenantId, f.tenant.id);
    assert.equal(audit[0].metadata.invitationId, f.invitation.id);
    await post("activate", { token: f.token, password: "Another very long passphrase" }).expect(400);
    assert.equal(
      await db.auditLog.count({ where: { entityId: f.membership.id, action: "MEMBERSHIP_ACTIVATED" } }),
      1,
    );
  });
  it("enforces 15-128 Unicode characters and a full-value blocklist, not composition rules", async () => {
    const f = await fixture();
    await post("activate", { token: f.token, password: null }).expect(400);
    for (const password of ["short", "x".repeat(129), "password123456", "doggycredit2026"])
      await post("activate", { token: f.token, password }).expect(400);
    assert.equal(
      (await db.membershipInvitation.findUniqueOrThrow({ where: { id: f.invitation.id } })).acceptedAt,
      null,
    );
    await post("activate", { token: f.token, password: "frase con espacios" }).expect(200);
    const g = await fixture();
    await post("activate", { token: g.token, password: "🔐".repeat(15) }).expect(200);
    const h = await fixture();
    await post("activate", { token: h.token, password: "x".repeat(128) }).expect(200);
    const i = await fixture();
    await post("activate", { token: i.token, password: "una frase doggycredit2026 más larga" }).expect(200);
  });
  it("an existing global user keeps credentials and other tenant memberships", async () => {
    const passwordHash = await hashPassword("Existing password remains 42");
    const a = await fixture({ status: "ACTIVE", passwordHash, platformRole: "OPERATOR" });
    await db.tenantMembership.update({ where: { id: a.membership.id }, data: { status: "ACTIVE" } });
    const b = await fixture({ user: a.user });
    const preview = await post("preview", { token: b.token }).expect(200);
    assert.equal(preview.body.requiresCredentialSetup, false);
    await post("activate", { token: b.token, password: "Unexpected reset attempt 123" }).expect(400);
    await post("activate", { token: b.token }).expect(200);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: a.user.id } })).passwordHash, passwordHash);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: a.user.id } })).platformRole, "OPERATOR");
    assert.equal(
      (await db.tenantMembership.findUniqueOrThrow({ where: { id: a.membership.id } })).status,
      "ACTIVE",
    );
    assert.equal(
      (await db.tenantMembership.findUniqueOrThrow({ where: { id: b.membership.id } })).status,
      "ACTIVE",
    );
  });
  it("concurrent requests have one winner, one password and one audit", async () => {
    const f = await fixture();
    const responses = await Promise.all([
      post("activate", { token: f.token, password: "First unique password 42" }),
      post("activate", { token: f.token, password: "Second unique password 42" }),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
    assert.equal(
      await db.auditLog.count({ where: { entityId: f.membership.id, action: "MEMBERSHIP_ACTIVATED" } }),
      1,
    );
    const user = await db.user.findUniqueOrThrow({ where: { id: f.user.id } });
    assert.ok(
      await verifyPassword(
        user.passwordHash,
        responses[0].status === 200 ? "First unique password 42" : "Second unique password 42",
      ),
    );
    assert.equal(
      (await db.membershipInvitation.findUniqueOrThrow({ where: { id: f.invitation.id } })).acceptedAt !==
        null,
      true,
    );
  });
  it("audit failure rolls back invitation, password and membership", async () => {
    const f = await fixture();
    const audit = app.get(AuditWriter);
    const original = audit.recordMembershipActivation;
    audit.recordMembershipActivation = async () => {
      throw new Error("injected audit failure");
    };
    try {
      await post("activate", { token: f.token, password: "Rollback password 12345" }).expect(500);
    } finally {
      audit.recordMembershipActivation = original;
    }
    assert.equal(
      (await db.membershipInvitation.findUniqueOrThrow({ where: { id: f.invitation.id } })).acceptedAt,
      null,
    );
    assert.equal(
      (await db.tenantMembership.findUniqueOrThrow({ where: { id: f.membership.id } })).status,
      "INVITED",
    );
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: f.user.id } })).passwordHash, null);
  });
  it("admin institutions projection follows actual membership status", async () => {
    const f = await fixture();
    const token = randomBytes(32).toString("base64url");
    const operator = await db.user.create({
      data: {
        email: `operator-${randomUUID()}@example.test`,
        fullName: "Operator",
        status: "ACTIVE",
        platformRole: "OPERATOR",
      },
    });
    await db.adminSession.create({
      data: { userId: operator.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 3600000) },
    });
    const list = () =>
      request(app.getHttpServer()).get("/api/admin/institutions").set("Cookie", `doggycredit_admin=${token}`);
    // Backoffice lists only tenants created from approved requests. This fixture gets real provenance below.
    const req = await db.institutionRequest.create({
      data: {
        institutionName: f.tenant.legalName,
        taxId: f.tenant.taxId,
        institutionType: "BANK",
        contactName: f.user.fullName,
        contactRole: "Manager",
        contactEmail: f.user.email,
        status: "APPROVED",
        emailVerifiedAt: new Date(),
        reviewedAt: new Date(),
      },
    });
    await db.tenant.update({ where: { id: f.tenant.id }, data: { createdFromRequestId: req.id } });
    const before = await list().expect(200);
    assert.equal(before.body.items.find((x) => x.tenantId === f.tenant.id).activationStatus, "INVITED");
    await post("activate", { token: f.token, password: "A proper password for demo" }).expect(200);
    const after = await list().expect(200);
    assert.equal(after.body.items.find((x) => x.tenantId === f.tenant.id).activationStatus, "ACTIVE");
  });
});
