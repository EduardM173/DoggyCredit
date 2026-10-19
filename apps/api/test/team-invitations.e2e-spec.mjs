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
    const verifiedAt = new Date();
    await db.user.update({ where: { id: existing.user.id }, data: { emailVerifiedAt: verifiedAt } });
    const cookie = (await admin.login()).headers["set-cookie"][0];
    const invited = await post(`${teamUrl(admin.tenant.slug)}/invitations`, cookie, {
      email: existing.user.email,
    }).expect(200);
    assert.equal(invited.body.emailSent, true);
    const token = tokenFrom(sent.at(-1));
    assert.equal((await preview(token).expect(200)).body.requiresCredentialSetup, false);
    const existingCookie = (await existing.login()).headers["set-cookie"][0];
    await get(`/api/institution/tenants/${admin.tenant.slug}/home`, existingCookie).expect(403);
    const other = await fixture("ANALYST");
    const otherCookie = (await other.login()).headers["set-cookie"][0];
    await request(app.getHttpServer())
      .post("/api/membership-invitations/activate")
      .set("Cookie", otherCookie)
      .send({ token })
      .expect(200);
    await get(`/api/institution/tenants/${admin.tenant.slug}/home`, otherCookie).expect(403);
    assert.equal(
      await db.tenantMembership.count({ where: { tenantId: admin.tenant.id, userId: other.user.id } }),
      0,
    );
    assert.equal(await db.user.count({ where: { email: existing.user.email } }), 1);
    const unchanged = await db.user.findUniqueOrThrow({ where: { id: existing.user.id } });
    assert.equal(unchanged.passwordHash, existing.user.passwordHash);
    assert.equal(unchanged.emailVerifiedAt.getTime(), verifiedAt.getTime());
    await get(`/api/institution/tenants/${admin.tenant.slug}/home`, existingCookie).expect(200);
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

  it("serializes invitations from two tenants into one global identity and separate pending memberships", async () => {
    const x = await fixture();
    const y = await fixture();
    const email = `shared-${randomUUID().slice(0, 8)}@example.test`;
    const xCookie = (await x.login()).headers["set-cookie"][0];
    const yCookie = (await y.login()).headers["set-cookie"][0];
    const responses = await Promise.all([
      post(`${teamUrl(x.tenant.slug)}/invitations`, xCookie, { email }),
      post(`${teamUrl(y.tenant.slug)}/invitations`, yCookie, { email }),
    ]);
    assert.deepEqual(
      responses.map((response) => response.status),
      [200, 200],
    );
    const users = await db.user.findMany({ where: { email } });
    assert.equal(users.length, 1);
    const memberships = await db.tenantMembership.findMany({ where: { userId: users[0].id } });
    assert.equal(memberships.length, 2);
    assert.deepEqual(
      new Set(memberships.map((member) => member.tenantId)),
      new Set([x.tenant.id, y.tenant.id]),
    );
    assert.ok(memberships.every((member) => member.status === "INVITED"));
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

  it("cancels a pending invitation and rejects its unexpired token", async () => {
    const admin = await fixture();
    const cookie = (await admin.login()).headers["set-cookie"][0];
    const email = `cancel-${randomUUID().slice(0, 8)}@example.test`;
    const invited = await post(`${teamUrl(admin.tenant.slug)}/invitations`, cookie, { email }).expect(200);
    const member = invited.body.team.members.find((row) => row.email === email);
    const token = tokenFrom(sent.at(-1));
    const url = `${teamUrl(admin.tenant.slug)}/members/${member.id}/cancel`;
    await post(url, cookie).expect(200);
    await post(url, cookie).expect(200);
    await preview(token).expect(400);
    await activate(token, { password }).expect(400);
    assert.equal((await db.tenantMembership.findUnique({ where: { id: member.id } })).status, "REVOKED");
    assert.equal(
      await db.auditLog.count({ where: { entityId: member.id, action: "INVITATION_CANCELLED" } }),
      1,
    );
  });

  it("only one of activation and cancellation wins a concurrent race", async () => {
    const admin = await fixture();
    const cookie = (await admin.login()).headers["set-cookie"][0];
    const email = `race-cancel-${randomUUID().slice(0, 8)}@example.test`;
    const invited = await post(`${teamUrl(admin.tenant.slug)}/invitations`, cookie, { email }).expect(200);
    const member = invited.body.team.members.find((row) => row.email === email);
    const token = tokenFrom(sent.at(-1));
    const [accepted, cancelled] = await Promise.all([
      activate(token, { password }),
      post(`${teamUrl(admin.tenant.slug)}/members/${member.id}/cancel`, cookie),
    ]);
    assert.ok([200, 400].includes(accepted.status));
    assert.ok([200, 409].includes(cancelled.status));
    assert.equal([accepted.status, cancelled.status].filter((status) => status === 200).length, 1);
    const state = await db.tenantMembership.findUnique({ where: { id: member.id } });
    assert.equal(state.status, accepted.status === 200 ? "ACTIVE" : "REVOKED");
  });

  it("suspends, reactivates and revokes only X while Y and global identity remain", async () => {
    const x = await fixture();
    const y = await fixture();
    const analyst = await fixture("ANALYST");
    const membershipX = await db.tenantMembership.create({
      data: { tenantId: x.tenant.id, userId: analyst.user.id, role: "ANALYST", status: "ACTIVE" },
    });
    const membershipY = await db.tenantMembership.create({
      data: { tenantId: y.tenant.id, userId: analyst.user.id, role: "ANALYST", status: "ACTIVE" },
    });
    const client = await db.client.create({
      data: {
        tenantId: x.tenant.id,
        type: "PERSON",
        documentType: "CI",
        documentNumber: `ci-${randomUUID()}`,
        name: "Solicitante de prueba",
      },
    });
    const evaluation = await db.evaluation.create({
      data: {
        tenantId: x.tenant.id,
        clientId: client.id,
        createdByMembershipId: membershipX.id,
        idempotencyKey: randomUUID(),
        purpose: "OTHER",
        requestedAmount: "1000.00",
        status: "IN_PROGRESS",
        applicantSnapshot: { name: client.name },
      },
    });
    const adminCookie = (await x.login()).headers["set-cookie"][0];
    const yCookie = (await y.login()).headers["set-cookie"][0];
    const analystLogin = await analyst.login();
    const analystCookie = analystLogin.headers["set-cookie"][0];
    const xHome = `/api/institution/tenants/${x.tenant.slug}/home`;
    const yHome = `/api/institution/tenants/${y.tenant.slug}/home`;
    await get(xHome, analystCookie).expect(200);
    await post(`${teamUrl(x.tenant.slug)}/members/${membershipY.id}/revoke`, adminCookie).expect(404);
    await post(`${teamUrl(x.tenant.slug)}/members/${membershipX.id}/suspend`, adminCookie).expect(200);
    await get(xHome, analystCookie).expect(403);
    await get(yHome, analystCookie).expect(200);
    const selector = await get("/api/institution/auth/me", analystCookie).expect(200);
    assert.ok(selector.body.activeMemberships.some((row) => row.tenant.slug === y.tenant.slug));
    assert.ok(!selector.body.activeMemberships.some((row) => row.tenant.slug === x.tenant.slug));
    await post(`${teamUrl(x.tenant.slug)}/members/${membershipX.id}/reactivate`, adminCookie).expect(200);
    await get(xHome, analystCookie).expect(200);
    await post(`${teamUrl(x.tenant.slug)}/members/${membershipX.id}/revoke`, adminCookie).expect(200);
    await get(xHome, analystCookie).expect(403);
    await get(yHome, analystCookie).expect(200);
    await get(`/api/institution/tenants/${x.tenant.slug}/evaluations/${evaluation.id}`, analystCookie).expect(
      403,
    );
    await get(`/api/institution/tenants/${x.tenant.slug}/evaluations/${evaluation.id}`, adminCookie).expect(
      200,
    );
    assert.equal(
      (await db.evaluation.findUnique({ where: { id: evaluation.id } })).createdByMembershipId,
      membershipX.id,
    );
    assert.equal((await db.evaluation.findUnique({ where: { id: evaluation.id } })).status, "IN_PROGRESS");
    await post(`${teamUrl(x.tenant.slug)}/members/${membershipX.id}/reactivate`, adminCookie).expect(409);
    assert.equal((await db.user.findUnique({ where: { id: analyst.user.id } })).status, "ACTIVE");
    assert.equal((await db.tenantMembership.findUnique({ where: { id: membershipY.id } })).status, "ACTIVE");
    assert.equal((await db.tenantMembership.findUnique({ where: { id: membershipX.id } })).status, "REVOKED");
    await post(`${teamUrl(y.tenant.slug)}/members/${membershipX.id}/revoke`, yCookie).expect(404);
  });

  it("accepts an invited replacement and serializes attempts to remove both administrators", async () => {
    const initial = await fixture();
    const firstCookie = (await initial.login()).headers["set-cookie"][0];
    const email = `replacement-${randomUUID().slice(0, 8)}@example.test`;
    const invited = await post(`${teamUrl(initial.tenant.slug)}/invitations`, firstCookie, {
      email,
      role: "INSTITUTION_ADMIN",
    }).expect(200);
    const replacement = invited.body.team.members.find((row) => row.email === email);
    const initialMember = invited.body.team.members.find((row) => row.isInitialAdmin);
    const token = tokenFrom(sent.at(-1));
    await post(`${teamUrl(initial.tenant.slug)}/members/${initialMember.id}/revoke`, firstCookie).expect(403);
    await activate(token, { password }).expect(200);
    const replacementLogin = await request(app.getHttpServer())
      .post("/api/institution/auth/login")
      .set("Origin", origin)
      .set("X-DoggyCredit-Institution", "1")
      .send({ email, password })
      .expect(200);
    const replacementCookie = replacementLogin.headers["set-cookie"][0];
    const [removeInitial, removeReplacement] = await Promise.all([
      post(`${teamUrl(initial.tenant.slug)}/members/${initialMember.id}/revoke`, replacementCookie),
      post(`${teamUrl(initial.tenant.slug)}/members/${replacement.id}/revoke`, firstCookie),
    ]);
    assert.ok(
      [403, 409].includes([removeInitial.status, removeReplacement.status].find((status) => status !== 200)),
    );
    assert.equal(
      [removeInitial.status, removeReplacement.status].filter((status) => status === 200).length,
      1,
    );
    assert.equal(
      await db.tenantMembership.count({
        where: { tenantId: initial.tenant.id, role: "INSTITUTION_ADMIN", status: "ACTIVE" },
      }),
      1,
    );
  });

  it("paginates team membership and counts statuses only within the selected tenant", async () => {
    const x = await fixture();
    const y = await fixture();
    const cookie = (await x.login()).headers["set-cookie"][0];
    const ids = Array.from({ length: 22 }, () => randomUUID());
    await db.user.createMany({
      data: ids.map((id) => ({ id, email: `page-${id}@example.test`, fullName: id, status: "ACTIVE" })),
    });
    await db.tenantMembership.createMany({
      data: ids.map((userId, index) => ({
        tenantId: x.tenant.id,
        userId,
        role: "ANALYST",
        status: index % 2 ? "SUSPENDED" : "REVOKED",
      })),
    });
    const first = await get(`${teamUrl(x.tenant.slug)}?page=1`, cookie).expect(200);
    const second = await get(`${teamUrl(x.tenant.slug)}?page=2`, cookie).expect(200);
    assert.equal(first.body.members.length, 20);
    assert.equal(second.body.members.length, 3);
    assert.equal(first.body.total, 23);
    assert.equal(first.body.pageCount, 2);
    assert.equal(first.body.counts.ACTIVE, 1);
    assert.equal(first.body.counts.REVOKED, 11);
    assert.equal(first.body.counts.SUSPENDED, 11);
    assert.ok(![...first.body.members, ...second.body.members].some((row) => row.email === y.user.email));
    await get(`${teamUrl(x.tenant.slug)}?page=0`, cookie).expect(400);
  });
});
