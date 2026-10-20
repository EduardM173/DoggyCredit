import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";
import { after, before, describe, it } from "node:test";
import request from "supertest";
import { Test } from "@nestjs/testing";
import { AppModule } from "../dist/app.module.js";
import { configureApplication } from "../dist/common/configure-application.js";
import { PrismaService } from "../dist/infrastructure/prisma/prisma.service.js";
import { EmailSender } from "../dist/infrastructure/email/email-sender.js";
import { hashPassword, verifyPassword } from "../dist/identity-tenants/auth/password-hashing.js";

describe("HU-31 platform team", () => {
  let app, db, admin, adminCookie, operatorCookie;
  const mail = [];
  let failMail = false;
  const origin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
  const password = "Prueba interna segura 2026!";
  const post = (url, cookie, body = {}) =>
    request(app.getHttpServer())
      .post(url)
      .set("Origin", origin)
      .set("X-DoggyCredit-Admin", "1")
      .set("Cookie", cookie)
      .send(body);
  const publicPost = (url, body) => request(app.getHttpServer()).post(url).send(body);
  const tokenFrom = (message) => message.text.match(/#token=([A-Za-z0-9_-]{43})/)?.[1];
  const login = (email, secret = password) => post("/api/admin/auth/login", "", { email, password: secret });
  const team = "/api/admin/platform/team";
  const unique = () => randomUUID().slice(0, 8);
  const bootstrapEmail = `bootstrap-${unique()}@example.test`;
  const runBootstrap = () =>
    new Promise((resolveRun) => {
      const root = resolve(process.cwd(), "../..");
      const child = spawn(
        process.execPath,
        [resolve(root, "node_modules/tsx/dist/cli.mjs"), resolve(root, "tools/bootstrap-platform-admin.ts")],
        {
          cwd: root,
          env: {
            ...process.env,
            PLATFORM_ADMIN_BOOTSTRAP_EMAIL: bootstrapEmail,
            PLATFORM_ADMIN_BOOTSTRAP_NAME: "Bootstrap",
            PLATFORM_ADMIN_BOOTSTRAP_PASSWORD: password,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stderr = "";
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk).slice(0, 1000);
      });
      child.on("exit", (code) => resolveRun({ code, stderr }));
    });

  before(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailSender)
      .useValue({
        send: async (message) => {
          if (failMail) throw new Error("test delivery failure");
          mail.push(message);
          return { channel: "TEST_INBOX" };
        },
      })
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(app);
    await app.init();
    db = app.get(PrismaService);
    const bootstraps = await Promise.all([runBootstrap(), runBootstrap()]);
    assert.deepEqual(
      bootstraps.map((result) => result.code),
      [0, 0],
      bootstraps.map((result) => result.stderr).join("\n"),
    );
    assert.equal(await db.user.count({ where: { platformRole: "PLATFORM_ADMIN" } }), 1);
    admin = await db.user.findUniqueOrThrow({ where: { email: bootstrapEmail } });
    adminCookie = (await login(admin.email).expect(200)).headers["set-cookie"][0];
  });
  after(async () => app?.close());

  it("invites, activates once and revokes an active operator with an old session", async () => {
    const email = `operator-${unique()}@example.test`;
    const issued = await post(`${team}/invitations`, adminCookie, {
      email,
      fullName: "Operador Interno",
    }).expect(200);
    assert.equal(issued.body.delivery, "ACCEPTED_BY_TRANSPORT");
    const token = tokenFrom(mail.at(-1));
    assert.ok(token);
    const preview = await publicPost("/api/platform-invitations/preview", { token }).expect(200);
    assert.equal(preview.body.role, "OPERATOR");
    assert.equal(preview.body.requiresCredentialSetup, true);
    const beforeAccess = await login(email).expect(401);
    assert.ok(beforeAccess.body);
    const acceptance = await Promise.all([
      publicPost("/api/platform-invitations/accept", { token, password }),
      publicPost("/api/platform-invitations/accept", { token, password }),
    ]);
    assert.deepEqual(acceptance.map((res) => res.status).sort(), [200, 400]);
    await publicPost("/api/platform-invitations/accept", { token, password }).expect(400);
    assert.ok(
      await db.auditLog.count({
        where: { action: "OPERATOR_INVITATION_REJECTED", entityType: "PlatformInvitation" },
      }),
    );
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    assert.equal(user.platformRole, "OPERATOR");
    operatorCookie = (await login(email).expect(200)).headers["set-cookie"][0];
    await request(app.getHttpServer()).get(team).set("Cookie", operatorCookie).expect(403);
    await post(`${team}/invitations`, operatorCookie, {
      email: `other-${unique()}@example.test`,
      fullName: "Otro",
    }).expect(403);
    await post(`${team}/invitations`, adminCookie, {
      email: `other-${unique()}@example.test`,
      fullName: "Otro",
      role: "PLATFORM_ADMIN",
    }).expect(400);
    await request(app.getHttpServer()).get(team).expect(401);
    assert.ok(await db.auditLog.count({ where: { actorUserId: user.id, action: "OPERATOR_ADMIN_DENIED" } }));
    await post(`${team}/${admin.id}/revoke`, adminCookie).expect(403);
    await post(`${team}/${user.id}/suspend`, adminCookie).expect(200);
    await request(app.getHttpServer())
      .get("/api/admin/auth/session")
      .set("Cookie", operatorCookie)
      .expect(401);
    await login(email).expect(401);
    await post(`${team}/${user.id}/reactivate`, adminCookie).expect(200);
    await request(app.getHttpServer())
      .get("/api/admin/auth/session")
      .set("Cookie", operatorCookie)
      .expect(401);
    const secondCookie = (await login(email).expect(200)).headers["set-cookie"][0];
    await post(`${team}/${user.id}/revoke`, adminCookie).expect(200);
    await post(`${team}/${user.id}/revoke`, adminCookie).expect(200);
    await request(app.getHttpServer()).get("/api/admin/auth/session").set("Cookie", secondCookie).expect(401);
    await post(`${team}/${user.id}/reactivate`, adminCookie).expect(409);
    assert.equal(
      (await db.user.findUniqueOrThrow({ where: { id: user.id } })).platformAccessStatus,
      "REVOKED",
    );
    const events = await db.auditLog.findMany({ where: { entityId: user.id, entityType: "User" } });
    assert.ok(events.some((event) => event.action === "OPERATOR_SUSPENDED"));
    assert.ok(events.some((event) => event.action === "OPERATOR_REACTIVATED"));
    assert.ok(events.some((event) => event.action === "OPERATOR_REVOKED"));
    assert.doesNotMatch(JSON.stringify(events), /#token=|passwordHash|doggycredit_admin/);
  });

  it("reuses verified identity and tenant membership without changing its password", async () => {
    const email = `existing-${unique()}@example.test`;
    const user = await db.user.create({
      data: {
        email,
        fullName: "Persona Existente",
        passwordHash: await hashPassword(password),
        status: "ACTIVE",
        emailVerifiedAt: new Date(),
      },
    });
    const tenant = await db.tenant.create({
      data: {
        slug: `hu31-${unique()}`,
        legalName: "Banco Test",
        taxId: `hu31-${unique()}`,
        institutionType: "BANK",
        status: "ACTIVE",
      },
    });
    await db.tenantMembership.create({
      data: { tenantId: tenant.id, userId: user.id, role: "ANALYST", status: "ACTIVE" },
    });
    await post(`${team}/invitations`, adminCookie, { email, fullName: "Nombre Nuevo" }).expect(200);
    const token = tokenFrom(mail.at(-1));
    assert.equal(
      (await publicPost("/api/platform-invitations/preview", { token }).expect(200)).body
        .requiresCredentialSetup,
      false,
    );
    await publicPost("/api/platform-invitations/accept", { token, password }).expect(400);
    await publicPost("/api/platform-invitations/accept", { token }).expect(200);
    const updated = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.equal(await verifyPassword(updated.passwordHash, password), true);
    assert.equal(updated.fullName, user.fullName);
    assert.equal(await db.user.count({ where: { email } }), 1);
    assert.equal(
      await db.tenantMembership.count({ where: { userId: user.id, tenantId: tenant.id, status: "ACTIVE" } }),
      1,
    );
  });

  it("rotates expired/failed invitations, rejects old links and leaves truthful delivery state", async () => {
    const email = `failed-${unique()}@example.test`;
    failMail = true;
    const first = await post(`${team}/invitations`, adminCookie, {
      email,
      fullName: "Correo Fallido",
    }).expect(200);
    assert.equal(first.body.delivery, "FAILED");
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    const pending = await db.platformInvitation.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(pending.sentAt, null);
    assert.equal(pending.sendErrorCode, "DELIVERY_FAILED");
    failMail = false;
    const resent = await post(`${team}/${user.id}/resend`, adminCookie).expect(200);
    assert.equal(resent.body.delivery, "ACCEPTED_BY_TRANSPORT");
    assert.ok((await db.platformInvitation.findUniqueOrThrow({ where: { id: pending.id } })).invalidatedAt);
    const token = tokenFrom(mail.at(-1));
    await db.platformInvitation.update({
      where: { id: resent.body.invitationId },
      data: { expiresAt: new Date(0) },
    });
    await publicPost("/api/platform-invitations/accept", { token, password }).expect(400);
    await post(`${team}/${user.id}/resend`, adminCookie).expect(409);
    await db.platformInvitation.update({
      where: { id: resent.body.invitationId },
      data: { sendAttemptedAt: new Date(0) },
    });
    await post(`${team}/${user.id}/resend`, adminCookie).expect(200);
    const replacement = tokenFrom(mail.at(-1));
    await publicPost("/api/platform-invitations/accept", { token, password }).expect(400);
    await post(`${team}/${user.id}/revoke`, adminCookie).expect(200);
    await publicPost("/api/platform-invitations/accept", { token: replacement, password }).expect(400);
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).platformRole, null);
  });

  it("serializes simultaneous invitations for one address without duplicate identities", async () => {
    const email = `race-${unique()}@example.test`;
    const responses = await Promise.all([
      post(`${team}/invitations`, adminCookie, { email, fullName: "Operador Uno" }),
      post(`${team}/invitations`, adminCookie, { email, fullName: "Operador Dos" }),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
    assert.equal(await db.user.count({ where: { email } }), 1);
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    assert.equal(await db.platformInvitation.count({ where: { userId: user.id, invalidatedAt: null } }), 1);
    const rejected = await db.auditLog.findFirst({
      where: { actorUserId: admin.id, action: "OPERATOR_INVITATION_REJECTED" },
      orderBy: { createdAt: "desc" },
    });
    assert.equal(rejected?.metadata?.reasonCode, "409");
    assert.doesNotMatch(JSON.stringify(rejected), /#token=|passwordHash/);
  });

  it("bootstrap is a guarded one-time deployment operation and never resets an existing admin", async () => {
    const repeated = await Promise.all([runBootstrap(), runBootstrap()]);
    assert.deepEqual(
      repeated.map((result) => result.code),
      [0, 0],
      repeated.map((result) => result.stderr).join("\n"),
    );
    assert.equal(await db.user.count({ where: { platformRole: "PLATFORM_ADMIN" } }), 1);
    assert.equal(await db.user.count({ where: { email: bootstrapEmail } }), 1);
    assert.equal((await runBootstrap()).code, 0);
  });
});
