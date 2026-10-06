import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import process from "node:process";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { Test } from "@nestjs/testing";
import { AppModule } from "../dist/app.module.js";
import { configureApplication } from "../dist/common/configure-application.js";
import { PrismaService } from "../dist/infrastructure/prisma/prisma.service.js";
import { EmailDeliveryError, EmailSender } from "../dist/infrastructure/email/email-sender.js";
import { hashPassword } from "../dist/identity-tenants/auth/password-hashing.js";

describe("HU-09 team invitations", () => {
  let app;
  let db;
  let rejectMail = false;
  const sent = [];
  const origin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  const password = "Frase segura para pruebas 2026!";
  const teamUrl = (slug) => `/api/institution/tenants/${slug}/team`;
  const post = (url, cookie, body = {}) =>
    request(app.getHttpServer())
      .post(url)
      .set("Cookie", cookie)
      .set("Origin", origin)
      .set("X-DoggyCredit-Institution", "1")
      .send(body);
  const get = (url, cookie) => request(app.getHttpServer()).get(url).set("Cookie", cookie);
  const tokenFrom = (mail) => {
    const token = mail.text.match(/#token=([A-Za-z0-9_-]{43})/)?.[1];
    assert.ok(token, "invitation email contains a one-time activation token");
    return token;
  };
  const preview = (token) =>
    request(app.getHttpServer()).post("/api/membership-invitations/preview").send({ token });
  const activate = (token, extra = {}) =>
    request(app.getHttpServer())
      .post("/api/membership-invitations/activate")
      .send({ token, ...extra });

  async function fixture(role = "INSTITUTION_ADMIN") {
    const suffix = randomUUID().slice(0, 8);
    const user = await db.user.create({
      data: {
        email: `hu09-${suffix}@example.test`,
        fullName: `Persona ${suffix}`,
        passwordHash: await hashPassword(password),
        status: "ACTIVE",
      },
    });
    const tenant = await db.tenant.create({
      data: {
        slug: `hu09-${suffix}`,
        legalName: `Banco ${suffix}`,
        taxId: `nit-${randomUUID()}`,
        institutionType: "BANK",
        status: "ACTIVE",
      },
    });
    await db.tenantMembership.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        role,
        status: "ACTIVE",
        isInitialAdmin: role === "INSTITUTION_ADMIN",
      },
    });
    const login = async () =>
      request(app.getHttpServer())
        .post("/api/institution/auth/login")
        .set("Origin", origin)
        .set("X-DoggyCredit-Institution", "1")
        .send({ email: user.email, password })
        .expect(200);
    return { user, tenant, login };
  }

  before(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailSender)
      .useValue({
        send: async (message) => {
          if (rejectMail) throw new EmailDeliveryError(false);
          sent.push(message);
        },
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(app);
    await app.init();
    db = app.get(PrismaService);
  });
  after(async () => app?.close());

  it("invites a new analyst, activates once and denies administrative actions", async () => {
    const admin = await fixture();
    const cookie = (await admin.login()).headers["set-cookie"][0];
    const email = `analyst-${randomUUID().slice(0, 8)}@example.test`;
    const invited = await post(`${teamUrl(admin.tenant.slug)}/invitations`, cookie, { email }).expect(200);
    assert.equal(invited.body.emailSent, true);
    assert.equal(invited.body.team.members.length, 2);
    const pending = invited.body.team.members.find((member) => member.email === email);
    assert.equal(pending.status, "INVITED");
    assert.equal(pending.role, "ANALYST");
    assert.ok(pending.invitation.sentAt);
    const token = tokenFrom(sent.at(-1));
    const details = await preview(token).expect(200);
    assert.equal(details.body.role, "ANALYST");
    assert.equal(details.body.institution.name, admin.tenant.legalName);
    assert.equal(details.body.requiresCredentialSetup, true);
    await activate(token, { password }).expect(200);
    const replay = await activate(token, { password }).expect(400);
    assert.match(replay.body.message, /utilizado/);
    const active = await get(teamUrl(admin.tenant.slug), cookie).expect(200);
    assert.equal(active.body.members.find((member) => member.email === email).status, "ACTIVE");
    assert.equal(active.body.members.find((member) => member.email === email).invitation, null);
    const login = await request(app.getHttpServer())
      .post("/api/institution/auth/login")
      .set("Origin", origin)
      .set("X-DoggyCredit-Institution", "1")
      .send({ email, password })
      .expect(200);
    assert.equal(login.body.resolution, "SINGLE_TENANT");
    assert.equal(login.body.tenant.slug, admin.tenant.slug);
    const analystCookie = login.headers["set-cookie"][0];
    const home = await get(`/api/institution/tenants/${admin.tenant.slug}/home`, analystCookie).expect(200);
    assert.equal(home.body.membership.role, "ANALYST");
    assert.equal(home.body.tenant.slug, admin.tenant.slug);
    await get(teamUrl(admin.tenant.slug), analystCookie).expect(403);
    await post(`${teamUrl(admin.tenant.slug)}/invitations`, analystCookie, {
      email: "other@example.test",
    }).expect(403);
    await post(`/api/institution/tenants/${admin.tenant.slug}/institution`, analystCookie, {
      name: "Cambio prohibido",
      type: "BANK",
    }).expect(403);
    await post(`/api/institution/tenants/${admin.tenant.slug}/source`, analystCookie).expect(403);
    await post(`/api/institution/tenants/${admin.tenant.slug}/products`, analystCookie, {
      productIds: [],
    }).expect(403);
    assert.equal(
      await db.tenantMembership.count({ where: { tenantId: admin.tenant.id, user: { email } } }),
      1,
    );
    assert.equal(
      await db.auditLog.count({ where: { tenantId: admin.tenant.id, action: "ANALYST_INVITATION_CREATED" } }),
      1,
    );
    assert.equal(
      await db.auditLog.count({ where: { tenantId: admin.tenant.id, action: "MEMBERSHIP_ACTIVATED" } }),
      1,
    );
  });

  it("reuses a global user from another tenant without replacing credentials", async () => {
    const admin = await fixture();
    const existing = await fixture("ANALYST");
    const cookie = (await admin.login()).headers["set-cookie"][0];
    const invited = await post(`${teamUrl(admin.tenant.slug)}/invitations`, cookie, {
      email: existing.user.email,
    }).expect(200);
    assert.equal(invited.body.emailSent, true);
    const token = tokenFrom(sent.at(-1));
    assert.equal((await preview(token).expect(200)).body.requiresCredentialSetup, false);
    await activate(token).expect(200);
    assert.equal(await db.user.count({ where: { email: existing.user.email } }), 1);
    const memberships = await db.tenantMembership.findMany({
      where: { userId: existing.user.id, status: "ACTIVE" },
    });
    assert.equal(memberships.length, 2);
    assert.ok(memberships.every((member) => member.role === "ANALYST"));
    const login = await existing.login();
    assert.equal(login.body.resolution, "MULTIPLE_TENANTS");
    assert.equal(login.body.tenants.length, 2);
    await post(`${teamUrl(admin.tenant.slug)}/invitations`, cookie, { email: existing.user.email }).expect(
      409,
    );
  });

  it("rejects duplicate/concurrent invitations and isolates tenant resources", async () => {
    const x = await fixture();
    const y = await fixture();
    const xCookie = (await x.login()).headers["set-cookie"][0];
    const yCookie = (await y.login()).headers["set-cookie"][0];
    const email = `race-${randomUUID().slice(0, 8)}@example.test`;
    const responses = await Promise.all([
      post(`${teamUrl(x.tenant.slug)}/invitations`, xCookie, { email }),
      post(`${teamUrl(x.tenant.slug)}/invitations`, xCookie, { email }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    const pending = responses
      .find((response) => response.status === 200)
      .body.team.members.find((member) => member.email === email);
    assert.equal(await db.tenantMembership.count({ where: { tenantId: x.tenant.id, user: { email } } }), 1);
    await get(teamUrl(x.tenant.slug), yCookie).expect(403);
    await post(`${teamUrl(x.tenant.slug)}/invitations`, yCookie, { email: "cross@example.test" }).expect(403);
    await post(`${teamUrl(y.tenant.slug)}/invitations/${pending.invitation.id}/resend`, yCookie).expect(404);
    await post(`${teamUrl(x.tenant.slug)}/invitations/${pending.invitation.id}/resend`, yCookie).expect(403);
    await post(`${teamUrl(x.tenant.slug)}/invitations`, xCookie, { email }).expect(409);
  });

  it("expires and resends a token, invalidating the previous link without new membership", async () => {
    const admin = await fixture();
    const cookie = (await admin.login()).headers["set-cookie"][0];
    const email = `expiry-${randomUUID().slice(0, 8)}@example.test`;
    const invited = await post(`${teamUrl(admin.tenant.slug)}/invitations`, cookie, { email }).expect(200);
    const firstToken = tokenFrom(sent.at(-1));
    const id = invited.body.team.members.find((member) => member.email === email).invitation.id;
    await db.membershipInvitation.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.match((await preview(firstToken).expect(400)).body.message, /venció/);
    const resent = await post(`${teamUrl(admin.tenant.slug)}/invitations/${id}/resend`, cookie).expect(200);
    assert.equal(resent.body.emailSent, true);
    const secondToken = tokenFrom(sent.at(-1));
    assert.notEqual(firstToken, secondToken);
    await preview(firstToken).expect(400);
    await activate(secondToken, { password }).expect(200);
    assert.equal(
      await db.tenantMembership.count({ where: { tenantId: admin.tenant.id, user: { email } } }),
      1,
    );
    assert.equal(
      await db.auditLog.count({ where: { tenantId: admin.tenant.id, action: "ANALYST_INVITATION_RESENT" } }),
      1,
    );
  });

  it("keeps failed delivery visible and recoverable", async () => {
    const admin = await fixture();
    const cookie = (await admin.login()).headers["set-cookie"][0];
    const email = `failure-${randomUUID().slice(0, 8)}@example.test`;
    rejectMail = true;
    try {
      const invited = await post(`${teamUrl(admin.tenant.slug)}/invitations`, cookie, { email }).expect(200);
      assert.equal(invited.body.emailSent, false);
      const invitation = invited.body.team.members.find((member) => member.email === email).invitation;
      assert.equal(invitation.sentAt, null);
      rejectMail = false;
      const resent = await post(
        `${teamUrl(admin.tenant.slug)}/invitations/${invitation.id}/resend`,
        cookie,
      ).expect(200);
      assert.equal(resent.body.emailSent, true);
      assert.equal(
        await db.tenantMembership.count({ where: { tenantId: admin.tenant.id, user: { email } } }),
        1,
      );
    } finally {
      rejectMail = false;
    }
  });
});
