import assert from "node:assert/strict";
import nodeProcess from "node:process";
import { setTimeout } from "node:timers";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath, URL, URLSearchParams } from "node:url";
import { resolve, dirname } from "node:path";
import { before, after, beforeEach, describe, it } from "node:test";
import pg from "pg";
import dotenv from "dotenv";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import request from "supertest";
import { AppModule } from "../dist/app.module.js";
import { configureApplication } from "../dist/common/configure-application.js";
import { PrismaService } from "../dist/infrastructure/prisma/prisma.service.js";
import { DatabaseUnitOfWork } from "../dist/infrastructure/prisma/database-unit-of-work.js";
import { EmailSender, EmailDeliveryError } from "../dist/infrastructure/email/email-sender.js";
import { ContractingService } from "../dist/plans-metering/contracting.service.js";
import { PaymentEventProcessor } from "../dist/plans-metering/payment-event-processor.js";
import { PaymentProvider } from "../dist/infrastructure/payments/payment-provider.js";
import { ProvisioningPlans } from "../dist/plans-metering/public.js";
import {
  ProvisioningQueue,
  ProvisionInstitutionService,
  TenantProvisioningWorker,
  InvitationDeliveryService,
} from "../dist/identity-tenants/public.js";
import { AuditWriter } from "../dist/audit/public.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: resolve(root, ".env"), quiet: true });
describe("HU-05 durable provisioning (isolated PostgreSQL database)", () => {
  let app, prisma, db, adminDb, config, commerce, worker, provisioner, delivery, operator, admin, free, paid;
  const database = `doggycredit_hu05_test_${randomUUID().replaceAll("-", "")}`;
  const originalUrl = nodeProcess.env.DATABASE_URL;
  const hash = (token) => createHash("sha256").update(token).digest("hex");
  let emails = [],
    sendFailure = null,
    sendCheck = null;
  const sender = {
    send: async (message) => {
      emails.push(message);
      if (sendCheck) await sendCheck();
      if (sendFailure) throw sendFailure;
    },
  };
  before(async () => {
    assert.match(database, /^doggycredit_hu05_test_[a-f0-9]{32}$/);
    adminDb = new pg.Client({ connectionString: originalUrl });
    await adminDb.connect();
    await adminDb.query(`CREATE DATABASE "${database}"`);
    const url = new URL(originalUrl);
    url.pathname = `/${database}`;
    nodeProcess.env.DATABASE_URL = url.toString();
    execFileSync(
      nodeProcess.execPath,
      [resolve(root, "node_modules/prisma/build/index.js"), "migrate", "deploy"],
      { cwd: root, env: nodeProcess.env, stdio: "pipe" },
    );
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailSender)
      .useValue(sender)
      .compile();
    app = module.createNestApplication({ logger: false });
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    db = app.get(DatabaseUnitOfWork);
    config = app.get(ConfigService);
    commerce = app.get(ContractingService);
    worker = app.get(TenantProvisioningWorker);
    provisioner = app.get(ProvisionInstitutionService);
    delivery = app.get(InvitationDeliveryService);
  });
  after(async () => {
    await app?.close();
    nodeProcess.env.DATABASE_URL = originalUrl;
    try {
      if (adminDb) {
        assert.match(database, /^doggycredit_hu05_test_[a-f0-9]{32}$/);
        await adminDb.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      }
    } finally {
      await adminDb?.end();
    }
  });
  beforeEach(async () => {
    assert.equal(new URL(nodeProcess.env.DATABASE_URL).pathname, `/${database}`);
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "InstitutionRequest", "Tenant", "User", "Plan", "PaymentProviderEvent", "MockPaymentCheckout" CASCADE',
    );
    emails = [];
    sendFailure = null;
    sendCheck = null;
    config.set("PAYMENT_PROVIDER", "mock");
    config.set("NODE_ENV", "test");
    config.set("TENANT_PROVISIONING_MAX_ATTEMPTS", 3);
    config.set("MEMBERSHIP_INVITATION_MAX_SEND_ATTEMPTS", 3);
    operator = await prisma.user.create({
      data: {
        email: "operator@example.test",
        fullName: "Operator",
        status: "ACTIVE",
        platformRole: "OPERATOR",
      },
    });
    const token = randomBytes(32).toString("base64url");
    await prisma.adminSession.create({
      data: { userId: operator.id, tokenHash: hash(token), expiresAt: new Date(Date.now() + 3600000) },
    });
    admin = `doggycredit_admin=${token}`;
    free = await prisma.plan.create({
      data: {
        code: "BASIC",
        isPublic: true,
        name: "Free",
        price: "0",
        currency: "BOB",
        billingPeriod: "MONTHLY",
        requiresPayment: false,
      },
    });
    paid = await prisma.plan.create({
      data: {
        code: "PAID",
        isPublic: true,
        name: "Paid",
        price: "349",
        currency: "BOB",
        billingPeriod: "MONTHLY",
        requiresPayment: true,
      },
    });
  });
  const make = async (overrides = {}) =>
    prisma.institutionRequest.create({
      data: {
        institutionName: "Banco de Prueba",
        taxId: randomUUID(),
        institutionType: "BANK",
        contactName: "Ana Administradora",
        contactRole: "Gerente",
        contactEmail: `${randomUUID()}@example.test`,
        planInterest: "ENTERPRISE",
        status: "APPROVED",
        emailVerifiedAt: new Date(),
        reviewedAt: new Date("2026-09-20T12:00:00Z"),
        ...overrides,
      },
    });
  const confirm = async (row, plan = free) => (await commerce.confirmPlan(row.id, plan.id)).contracting;
  const process = async (contract) => {
    const job = await worker.claim();
    assert.equal(job.contractingId, contract.id);
    await provisioner.provision(contract.id, job.leaseToken);
    return prisma.tenantProvisioning.findUniqueOrThrow({ where: { contractingId: contract.id } });
  };
  const counts = () =>
    Promise.all([
      prisma.tenant.count(),
      prisma.tenantSubscription.count(),
      prisma.tenantMembership.count(),
      prisma.membershipInvitation.count(),
      prisma.user.count(),
      prisma.auditLog.count({ where: { action: "TENANT_PROVISIONED" } }),
    ]);
  const list = (query = "", cookie = admin) =>
    request(app.getHttpServer()).get(`/api/admin/institutions${query}`).set("Cookie", cookie);
  async function paidContract(result = "PAID") {
    const row = await make();
    const contract = await confirm(row, paid);
    const view = await commerce.createPayment(row.id, "BANK_TRANSFER", randomUUID());
    const payment = view.contracting.payment;
    const event = await app.get(PaymentProvider).resolveTransfer(`mock_${payment.id}`, result);
    await app.get(PaymentEventProcessor).process(event);
    return { row, contract, payment, event };
  }
  it("APPROVED alone does not create a tenant or durable job", async () => {
    await make();
    await worker.tick();
    assert.equal(await prisma.tenant.count(), 0);
    assert.equal(await prisma.tenantProvisioning.count(), 0);
  });
  it("adds demo products only when a new institution is provisioned in development", async () => {
    config.set("NODE_ENV", "development");
    const row = await make();
    const contract = await confirm(row);
    const job = await process(contract);
    const products = await prisma.financialProduct.findMany({
      where: { tenantId: job.tenantId },
      include: { purposes: true },
    });
    assert.deepEqual(products.map((product) => product.name).sort(), [
      "Crédito Verde",
      "Microcrédito Emprendedor",
      "Pyme Crece",
    ]);
    assert.ok(products.every((product) => !product.active && product.purposes.length > 0));
    await provisioner.provision(contract.id, randomUUID());
    assert.equal(await prisma.financialProduct.count({ where: { tenantId: job.tenantId } }), 3);
    const productionRequest = await make();
    const productionContract = await confirm(productionRequest);
    config.set("NODE_ENV", "production");
    const productionJob = await process(productionContract);
    assert.equal(await prisma.financialProduct.count({ where: { tenantId: productionJob.tenantId } }), 0);
  });
  it("free confirmation atomically creates one durable pending job without Payment", async () => {
    const row = await make();
    const c = await confirm(row);
    await confirm(row);
    const jobs = await prisma.tenantProvisioning.findMany();
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].contractingId, c.id);
    assert.equal(jobs[0].status, "PENDING");
    assert.equal(await prisma.payment.count(), 0);
    assert.equal(await prisma.tenant.count(), 0);
  });
  it("failed durable hook rolls back confirmation and its audit", async () => {
    const row = await make();
    const queue = app.get(ProvisioningQueue);
    const original = queue.ensurePending;
    queue.ensurePending = async () => {
      throw new Error("injected");
    };
    try {
      await assert.rejects(() => confirm(row));
    } finally {
      queue.ensurePending = original;
    }
    assert.equal(await prisma.contracting.count(), 0);
    assert.equal(await prisma.auditLog.count({ where: { action: "CONTRACTING_CONFIRMED" } }), 0);
  });
  it("paid confirmation creates exactly one job even when event repeats", async () => {
    const { event } = await paidContract();
    await app.get(PaymentEventProcessor).process(event);
    assert.equal(await prisma.tenantProvisioning.count(), 1);
    assert.equal((await prisma.tenantProvisioning.findFirstOrThrow()).status, "PENDING");
  });
  it("job survives closing and reinitializing a Nest application", async () => {
    const row = await make();
    const c = await confirm(row);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(EmailSender)
      .useValue(sender)
      .compile();
    const restarted = module.createNestApplication({ logger: false });
    await restarted.init();
    try {
      await restarted.get(TenantProvisioningWorker).tick();
    } finally {
      await restarted.close();
    }
    assert.equal(
      (await prisma.tenantProvisioning.findUniqueOrThrow({ where: { contractingId: c.id } })).status,
      "COMPLETED",
    );
    assert.equal(await prisma.tenant.count(), 1);
  });
  for (const state of ["EMAIL_PENDING", "PENDING_REVIEW", "REJECTED"])
    it(`provisioning rechecks request ${state}`, async () => {
      const row = await make();
      const c = await confirm(row);
      await prisma.institutionRequest.update({ where: { id: row.id }, data: { status: state } });
      await worker.tick();
      const job = await prisma.tenantProvisioning.findUniqueOrThrow({ where: { contractingId: c.id } });
      assert.equal(job.status, "FAILED_PERMANENT");
      assert.equal(job.lastErrorCode, "REQUEST_NOT_APPROVED");
      assert.equal(await prisma.tenant.count(), 0);
    });
  for (const state of ["PENDING", "FAILED", "CANCELLED"])
    it(`paid ${state} cannot provision even with incorrectly confirmed Contracting`, async () => {
      let row, c;
      if (state === "PENDING") {
        row = await make();
        c = await confirm(row, paid);
        await commerce.createPayment(row.id, "QR", randomUUID());
      } else {
        const f = await paidContract(state);
        row = f.row;
        c = f.contract;
      }
      assert.equal(await prisma.tenantProvisioning.count(), 0);
      await prisma.contracting.update({
        where: { id: c.id },
        data: { status: "CONFIRMED", confirmedAt: new Date() },
      });
      await app.get(ProvisioningQueue).ensurePending(c.id, row.id);
      await worker.tick();
      assert.equal(await prisma.tenant.count(), 0);
      assert.equal(
        (await prisma.tenantProvisioning.findFirstOrThrow()).lastErrorCode,
        "PAID_PAYMENT_REQUIRED",
      );
    });
  it("confirmed paid contract without any Payment is rejected", async () => {
    const row = await make();
    const c = await confirm(row, paid);
    await prisma.contracting.update({
      where: { id: c.id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
    await app.get(ProvisioningQueue).ensurePending(c.id, row.id);
    await worker.tick();
    assert.equal(await prisma.tenant.count(), 0);
  });
  it("PAID on a different contract does not authorize provisioning", async () => {
    await paidContract();
    const row = await make();
    const c = await confirm(row, paid);
    await prisma.contracting.update({
      where: { id: c.id },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
    });
    await assert.rejects(() => app.get(ProvisioningPlans).eligibility(c.id));
  });
  it("rechecks confirmed state before any provisioning write", async () => {
    const row = await make();
    const c = await confirm(row);
    await prisma.contracting.update({ where: { id: c.id }, data: { status: "PENDING_PAYMENT" } });
    await worker.tick();
    assert.equal(await prisma.tenant.count(), 0);
    assert.equal((await prisma.tenantProvisioning.findFirstOrThrow()).status, "FAILED_PERMANENT");
  });
  for (const kind of ["free", "paid"])
    it(`${kind} creates one complete structure, correct plan and SYSTEM audit`, async () => {
      const c = kind === "free" ? await confirm(await make()) : (await paidContract()).contract;
      const job = await process(c);
      assert.equal(job.status, "COMPLETED");
      assert.ok(job.completedAt);
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { id: job.tenantId },
        include: { memberships: { include: { user: true, invitations: true } }, subscriptions: true },
      });
      assert.equal(tenant.createdFromRequestId, job.institutionRequestId);
      assert.equal(tenant.subscriptions[0].planId, kind === "free" ? free.id : paid.id);
      assert.equal(tenant.subscriptions[0].sourceContractingId, c.id);
      assert.equal(tenant.subscriptions[0].status, "ACTIVE");
      const m = tenant.memberships[0];
      assert.equal(m.role, "INSTITUTION_ADMIN");
      assert.equal(m.status, "INVITED");
      assert.equal(m.isInitialAdmin, true);
      assert.equal(m.user.status, "INVITED");
      assert.equal(m.user.passwordHash, null);
      assert.equal(m.user.platformRole, null);
      assert.equal(m.invitations.length, 1);
      assert.equal(m.invitations[0].membershipId, m.id);
      assert.equal(m.invitations[0].tenantId, tenant.id);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "TENANT_PROVISIONED" } });
      assert.equal(audit.actorUserId, null);
      assert.equal(audit.metadata.actorKind, "SYSTEM");
      assert.doesNotMatch(JSON.stringify(audit), /tokenHash|password|cookie|token=/);
      assert.equal(emails.length, 0);
    });
  it("does not replace the contracted plan after catalog changes or contradictory planInterest", async () => {
    const row = await make({ planInterest: "PAID" });
    const c = await confirm(row);
    await prisma.plan.update({
      where: { id: free.id },
      data: { active: false, price: "99", requiresPayment: true },
    });
    await process(c);
    assert.equal((await prisma.tenantSubscription.findFirstOrThrow()).planId, free.id);
    assert.equal(
      (await prisma.institutionRequest.findUniqueOrThrow({ where: { id: row.id } })).planInterest,
      "PAID",
    );
  });
  it("global active user and credentials are preserved; new membership stays INVITED", async () => {
    const user = await prisma.user.create({
      data: {
        email: "ana@example.test",
        fullName: "Validated Name",
        passwordHash: "existing-password-hash",
        status: "ACTIVE",
        platformRole: "PLATFORM_ADMIN",
      },
    });
    const row = await make({ contactEmail: " ANA@EXAMPLE.TEST " });
    await process(await confirm(row));
    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    assert.deepEqual(after, user);
    const m = await prisma.tenantMembership.findFirstOrThrow();
    assert.equal(m.userId, user.id);
    assert.equal(m.status, "INVITED");
    const view = await list().expect(200);
    assert.equal(view.body.items[0].activationStatus, "INVITED");
    assert.equal(view.body.items[0].initialAdmin.name, "Validated Name");
  });
  it("email uniqueness is case insensitive in PostgreSQL", async () => {
    await prisma.user.create({ data: { email: "ana@example.test", fullName: "Ana" } });
    await assert.rejects(() =>
      prisma.user.create({ data: { email: "ANA@EXAMPLE.TEST", fullName: "Duplicate" } }),
    );
  });
  it("repeated provisioning x5 has stable entities and one audit", async () => {
    const c = await confirm(await make());
    const job = await process(c);
    const before = await counts();
    for (let i = 0; i < 5; i++) assert.equal(await provisioner.provision(c.id, randomUUID()), job.tenantId);
    assert.deepEqual(await counts(), before);
  });
  it("two claims have one winner and concurrent provision calls create once", async () => {
    const c = await confirm(await make());
    const claims = await Promise.all([worker.claim(), worker.claim()]);
    assert.equal(claims.filter(Boolean).length, 1);
    const winner = claims.find(Boolean);
    const tenants = await Promise.all([
      provisioner.provision(c.id, winner.leaseToken),
      provisioner.provision(c.id, winner.leaseToken),
    ]);
    assert.equal(tenants[0], tenants[1]);
    assert.deepEqual(await counts(), [1, 1, 1, 1, 2, 1]);
  });
  it("stale PROCESSING is reclaimed and old lease cannot write", async () => {
    const c = await confirm(await make());
    const old = await worker.claim();
    await prisma.tenantProvisioning.update({ where: { id: old.id }, data: { lockedAt: new Date(0) } });
    const current = await worker.claim();
    assert.notEqual(old.leaseToken, current.leaseToken);
    assert.equal(await provisioner.provision(c.id, old.leaseToken), null);
    assert.equal(await prisma.tenant.count(), 0);
    await provisioner.provision(c.id, current.leaseToken);
    assert.equal(await prisma.tenant.count(), 1);
  });
  it("fresh lease cannot be stolen", async () => {
    await confirm(await make());
    await worker.claim();
    assert.equal(await worker.claim(), null);
  });
  it("exhausted crashed lease becomes permanent rather than stuck forever", async () => {
    await confirm(await make());
    const job = await worker.claim();
    await prisma.tenantProvisioning.update({
      where: { id: job.id },
      data: { lockedAt: new Date(0), attemptCount: 3 },
    });
    assert.equal(await worker.claim(), null);
    assert.equal(
      (await prisma.tenantProvisioning.findUniqueOrThrow({ where: { id: job.id } })).status,
      "FAILED_PERMANENT",
    );
  });
  it("transient DB failure uses bounded backoff then recovers", async () => {
    const c = await confirm(await make());
    const original = provisioner.provision;
    provisioner.provision = async () => {
      throw Object.assign(new Error("private"), { code: "P2034" });
    };
    try {
      await worker.tick();
      const job = await prisma.tenantProvisioning.findFirstOrThrow();
      assert.equal(job.status, "FAILED_RETRYABLE");
      assert.ok(job.nextAttemptAt > new Date());
      assert.equal(job.lastErrorCode, "DATABASE_TEMPORARY");
    } finally {
      provisioner.provision = original;
    }
    await prisma.tenantProvisioning.update({
      where: { contractingId: c.id },
      data: { nextAttemptAt: new Date(0) },
    });
    await worker.tick();
    assert.equal((await prisma.tenantProvisioning.findFirstOrThrow()).status, "COMPLETED");
  });
  it("unknown programming failure is not retried indefinitely", async () => {
    await confirm(await make());
    const original = provisioner.provision;
    provisioner.provision = async () => {
      throw new Error("private-sensitive-details");
    };
    try {
      await worker.tick();
    } finally {
      provisioner.provision = original;
    }
    const job = await prisma.tenantProvisioning.findFirstOrThrow();
    assert.equal(job.status, "FAILED_PERMANENT");
    assert.equal(job.lastErrorCode, "PROVISIONING_INTERNAL_ERROR");
    await worker.tick();
    assert.equal((await prisma.tenantProvisioning.findFirstOrThrow()).attemptCount, 1);
  });
  it("colliding names have unique stable readable slugs, including empty normalized names", async () => {
    for (const name of ["Bánco del Sol S.A.", "Banco del Sol S.A.", "!!!"]) {
      const row = await make({ institutionName: name });
      await process(await confirm(row));
    }
    const rows = await prisma.tenant.findMany({ orderBy: { createdAt: "asc" } });
    assert.equal(rows[0].slug, "banco-del-sol-s-a");
    assert.match(rows[1].slug, /^banco-del-sol-s-a-[a-f0-9]{8}$/);
    assert.equal(rows[2].slug, "institucion");
  });
  for (const entity of ["tenant", "user", "tenantMembership", "tenantSubscription", "membershipInvitation"])
    it(`${entity} critical write failure rolls back all entities`, async () => {
      const c = await confirm(await make());
      const job = await worker.claim();
      await assert.rejects(() =>
        db.run(async () => {
          const delegate = db.client[entity];
          const original = delegate.create;
          delegate.create = async function (...args) {
            await original.apply(this, args);
            throw new Error("injected rollback");
          };
          try {
            await provisioner.provision(c.id, job.leaseToken);
          } finally {
            delegate.create = original;
          }
        }),
      );
      assert.deepEqual(await counts(), [0, 0, 0, 0, 1, 0]);
      assert.notEqual((await prisma.tenantProvisioning.findFirstOrThrow()).status, "COMPLETED");
    });
  it("critical audit failure rolls back all provisioning", async () => {
    const c = await confirm(await make());
    const job = await worker.claim();
    const audit = app.get(AuditWriter);
    const original = audit.recordProvisioning;
    audit.recordProvisioning = async function (e) {
      await original.call(this, e);
      throw new Error("injected");
    };
    try {
      await assert.rejects(() => provisioner.provision(c.id, job.leaseToken));
    } finally {
      audit.recordProvisioning = original;
    }
    assert.deepEqual(await counts(), [0, 0, 0, 0, 1, 0]);
  });
  it("email runs after commit with correct identity, institution, URL and hash-only token", async () => {
    await process(await confirm(await make()));
    sendCheck = async () => {
      assert.equal(db.client, prisma);
      assert.equal(await prisma.tenant.count(), 1);
      assert.equal((await prisma.tenantProvisioning.findFirstOrThrow()).status, "COMPLETED");
    };
    await delivery.tick();
    assert.equal(emails.length, 1);
    const message = emails[0];
    assert.match(message.text, /Ana Administradora/);
    assert.match(message.text, /Banco de Prueba/);
    assert.match(message.html, /Activar cuenta/);
    const url = new URL(message.text.match(/Activar cuenta: (\S+)/)[1]);
    assert.equal(url.origin, new URL(config.getOrThrow("PUBLIC_APP_URL")).origin);
    assert.equal(url.pathname, "/activar-cuenta");
    const token = new URLSearchParams(url.hash.slice(1)).get("token");
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    const invitation = await prisma.membershipInvitation.findFirstOrThrow();
    assert.equal(invitation.tokenHash, hash(token));
    assert.ok(invitation.sentAt);
    assert.equal(invitation.acceptedAt, null);
    assert.ok(invitation.expiresAt > new Date(Date.now() + 47 * 3600000));
    assert.equal((await prisma.tenantMembership.findFirstOrThrow()).status, "INVITED");
    assert.ok(!JSON.stringify(invitation).includes(token));
    await delivery.tick();
    assert.equal(emails.length, 1);
  });
  it("email failure keeps provisioning completed and retry rotates without duplicating entities", async () => {
    await process(await confirm(await make()));
    const before = await counts();
    sendFailure = new EmailDeliveryError(true);
    await delivery.tick();
    assert.equal(emails.length, 2);
    assert.equal(emails[0].idempotencyKey, emails[1].idempotencyKey);
    const previous = await prisma.membershipInvitation.findFirstOrThrow();
    assert.equal(previous.sentAt, null);
    assert.ok(previous.nextSendAttemptAt);
    assert.equal((await prisma.tenantProvisioning.findFirstOrThrow()).status, "COMPLETED");
    sendFailure = null;
    await prisma.membershipInvitation.update({
      where: { id: previous.id },
      data: { nextSendAttemptAt: new Date(0) },
    });
    await delivery.tick();
    const next = await prisma.membershipInvitation.findFirstOrThrow();
    assert.notEqual(next.tokenHash, previous.tokenHash);
    assert.equal(next.version, previous.version + 1);
    assert.notEqual(emails[2].idempotencyKey, emails[0].idempotencyKey);
    assert.deepEqual(await counts(), before);
    assert.equal((await prisma.tenantMembership.findFirstOrThrow()).status, "INVITED");
  });
  it("permanent mail failure does not automatically retry", async () => {
    await process(await confirm(await make()));
    sendFailure = new EmailDeliveryError(false);
    await delivery.tick();
    await delivery.tick();
    assert.equal(emails.length, 1);
    assert.equal((await prisma.membershipInvitation.findFirstOrThrow()).nextSendAttemptAt, null);
  });
  it("two delivery workers claim only once", async () => {
    await process(await confirm(await make()));
    await Promise.all([delivery.tick(), delivery.tick()]);
    assert.equal(emails.length, 1);
  });
  it("each invitation starts a fresh lease even after a slow earlier delivery", async (t) => {
    await process(await confirm(await make()));
    await process(await confirm(await make({ contactEmail: "second@example.test" })));
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
    sendCheck = async () => {
      const locked = await prisma.membershipInvitation.findFirstOrThrow({
        where: { sendLeaseToken: { not: null } },
      });
      assert.ok(Date.now() - locked.sendLockedAt.getTime() < 1000);
      if (emails.length === 1) t.mock.timers.tick(61000);
    };
    try {
      await delivery.tick();
      assert.equal(emails.length, 2);
    } finally {
      t.mock.timers.reset();
    }
  });
  it("database rejects duplicate membership, active subscription and current invitation", async () => {
    await process(await confirm(await make()));
    const m = await prisma.tenantMembership.findFirstOrThrow();
    await assert.rejects(() =>
      prisma.tenantMembership.create({ data: { tenantId: m.tenantId, userId: m.userId, role: m.role } }),
    );
    await assert.rejects(() =>
      prisma.tenantSubscription.create({ data: { tenantId: m.tenantId, planId: paid.id } }),
    );
    await assert.rejects(() =>
      prisma.membershipInvitation.create({
        data: {
          tenantId: m.tenantId,
          membershipId: m.id,
          tokenHash: hash(randomUUID()),
          expiresAt: new Date(),
        },
      }),
    );
  });
  it("admin institutions requires authentication and OPERATOR role", async () => {
    await list("", "").expect(401);
    await prisma.user.update({ where: { id: operator.id }, data: { platformRole: null } });
    await list().expect(403);
  });
  it("list includes provisioned institutions only, approval date and safe projection", async () => {
    await make();
    const row = await make({ reviewedAt: new Date("2026-09-01T08:00:00Z") });
    await process(await confirm(row));
    const r = await list().expect(200);
    assert.equal(r.body.total, 1);
    assert.equal(r.body.items[0].approvedAt, "2026-09-01T08:00:00.000Z");
    assert.equal(r.body.items[0].activationStatus, "INVITED");
    assert.doesNotMatch(
      JSON.stringify(r.body),
      /passwordHash|tokenHash|Payment|price|providerReference|secret/,
    );
  });
  it("does not fabricate an approval date for legacy data", async () => {
    await process(await confirm(await make({ reviewedAt: null })));
    const r = await list().expect(200);
    assert.equal(r.body.items[0].approvedAt, null);
  });
  it("backend search matches institution, normalized NIT, admin name and email", async () => {
    await process(
      await confirm(
        await make({
          institutionName: "Financiera Única",
          taxId: "123456789",
          contactEmail: "ana@unique.example.test",
        }),
      ),
    );
    for (const q of ["financiera", "123.456.789", "Administradora", "ANA@UNIQUE"]) {
      const r = await list(`?search=${encodeURIComponent(q)}`).expect(200);
      assert.equal(r.body.total, 1);
    }
    assert.equal((await list("?search=absent").expect(200)).body.total, 0);
  });
  it("activation filter uses initial membership, never global User status", async () => {
    await process(await confirm(await make()));
    await prisma.user.updateMany({ where: { platformRole: null }, data: { status: "ACTIVE" } });
    assert.equal((await list("?activationStatus=ACTIVE").expect(200)).body.total, 0);
    assert.equal((await list("?activationStatus=INVITED").expect(200)).body.total, 1);
    await prisma.tenantMembership.updateMany({ data: { status: "ACTIVE" } });
    assert.equal((await list("?activationStatus=ACTIVE").expect(200)).body.total, 1);
  });
  it("server pagination sorts by approval then unique tenant id", async () => {
    for (let i = 0; i < 3; i++)
      await process(
        await confirm(await make({ reviewedAt: new Date(i === 0 ? "2026-01-01" : "2026-02-01") })),
      );
    const a = (await list("?page=1&pageSize=2").expect(200)).body;
    const b = (await list("?page=2&pageSize=2").expect(200)).body;
    assert.equal(a.total, 3);
    assert.equal(a.items.length, 2);
    assert.equal(b.items.length, 1);
    assert.equal(b.items[0].approvedAt, "2026-01-01T00:00:00.000Z");
    assert.ok(a.items[0].tenantId > a.items[1].tenantId);
  });
  it("an active membership in tenant A does not activate tenant B", async () => {
    const email = "shared@example.test";
    await process(await confirm(await make({ contactEmail: email })));
    const first = await prisma.tenantMembership.findFirstOrThrow();
    await prisma.tenantMembership.update({ where: { id: first.id }, data: { status: "ACTIVE" } });
    await prisma.user.update({
      where: { id: first.userId },
      data: { status: "ACTIVE", passwordHash: "preserved" },
    });
    await process(await confirm(await make({ contactEmail: email })));
    const memberships = await prisma.tenantMembership.findMany({ where: { userId: first.userId } });
    assert.equal(memberships.length, 2);
    assert.equal(memberships.find((m) => m.id === first.id).status, "ACTIVE");
    assert.equal(memberships.find((m) => m.id !== first.id).status, "INVITED");
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: first.userId } })).passwordHash,
      "preserved",
    );
  });
  it("conflicting active subscription is not silently replaced", async () => {
    const row = await make();
    const c = await confirm(row);
    const tenant = await prisma.tenant.create({
      data: {
        slug: "existing",
        legalName: row.institutionName,
        taxId: row.taxId,
        institutionType: "BANK",
        createdFromRequestId: row.id,
      },
    });
    await prisma.tenantSubscription.create({
      data: { tenantId: tenant.id, planId: paid.id, status: "ACTIVE" },
    });
    await worker.tick();
    assert.equal(
      (await prisma.tenantProvisioning.findFirstOrThrow()).lastErrorCode,
      "ACTIVE_SUBSCRIPTION_CONFLICT",
    );
    assert.equal(await prisma.tenantMembership.count(), 0);
    assert.equal((await prisma.tenantSubscription.findFirstOrThrow()).planId, paid.id);
    assert.notEqual(
      (await prisma.tenantProvisioning.findUniqueOrThrow({ where: { contractingId: c.id } })).status,
      "COMPLETED",
    );
  });
  it("incompatible preexisting membership causes controlled rollback", async () => {
    const row = await make({ contactEmail: operator.email });
    await confirm(row);
    const tenant = await prisma.tenant.create({
      data: {
        slug: "existing",
        legalName: row.institutionName,
        taxId: row.taxId,
        institutionType: "BANK",
        createdFromRequestId: row.id,
      },
    });
    const m = await prisma.tenantMembership.create({
      data: { tenantId: tenant.id, userId: operator.id, role: "ANALYST", status: "ACTIVE" },
    });
    await worker.tick();
    assert.equal(
      (await prisma.tenantProvisioning.findFirstOrThrow()).lastErrorCode,
      "INITIAL_MEMBERSHIP_CONFLICT",
    );
    assert.deepEqual(await prisma.tenantMembership.findUniqueOrThrow({ where: { id: m.id } }), m);
    assert.equal(await prisma.tenantSubscription.count(), 0);
  });
  it("transient provisioning retries stop at the configured limit", async () => {
    await confirm(await make());
    const original = provisioner.provision;
    provisioner.provision = async () => {
      throw Object.assign(new Error("transient"), { code: "P2034" });
    };
    try {
      for (let i = 0; i < 4; i++) {
        await prisma.tenantProvisioning.updateMany({
          where: { status: "FAILED_RETRYABLE" },
          data: { nextAttemptAt: new Date(0) },
        });
        await worker.tick();
      }
    } finally {
      provisioner.provision = original;
    }
    const job = await prisma.tenantProvisioning.findFirstOrThrow();
    assert.equal(job.attemptCount, 3);
    assert.equal(job.status, "FAILED_PERMANENT");
  });
  it("mail recovers an expired send lease by rotating its token", async () => {
    await process(await confirm(await make()));
    const before = await prisma.membershipInvitation.findFirstOrThrow();
    await prisma.membershipInvitation.update({
      where: { id: before.id },
      data: { sendLockedAt: new Date(0), sendLeaseToken: randomUUID(), sendAttempts: 1 },
    });
    await delivery.tick();
    const after = await prisma.membershipInvitation.findFirstOrThrow();
    assert.ok(after.sentAt);
    assert.notEqual(before.tokenHash, after.tokenHash);
    assert.equal(after.sendAttempts, 2);
  });
  it("mail retries and crashed final lease are finite", async () => {
    await process(await confirm(await make()));
    sendFailure = new EmailDeliveryError(true);
    for (let i = 0; i < 4; i++) {
      await prisma.membershipInvitation.updateMany({ data: { nextSendAttemptAt: new Date(0) } });
      await delivery.tick();
    }
    assert.equal(emails.length, 6);
    let invitation = await prisma.membershipInvitation.findFirstOrThrow();
    assert.equal(invitation.sendAttempts, 3);
    await prisma.membershipInvitation.update({
      where: { id: invitation.id },
      data: { sendLockedAt: new Date(0), sendLeaseToken: randomUUID() },
    });
    await delivery.tick();
    invitation = await prisma.membershipInvitation.findFirstOrThrow();
    assert.equal(invitation.lastSendErrorCode, "EMAIL_ATTEMPTS_EXHAUSTED");
    assert.equal(invitation.sendLockedAt, null);
  });
  it("normal bootstrap scheduling processes automatically without a manual tick", async () => {
    await confirm(await make());
    config.set("TENANT_PROVISIONING_ENABLED", true);
    worker.start();
    try {
      for (let i = 0; i < 100; i++) {
        if ((await prisma.tenantProvisioning.findFirstOrThrow()).status === "COMPLETED") break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.equal((await prisma.tenantProvisioning.findFirstOrThrow()).status, "COMPLETED");
    } finally {
      await worker.onModuleDestroy();
      config.set("TENANT_PROVISIONING_ENABLED", false);
    }
  });
  for (const query of [
    "page=0",
    "pageSize=101",
    "page=1.5",
    "activationStatus=WRONG",
    "search=" + "a".repeat(181),
    "tenantId=" + randomUUID(),
  ])
    it(`rejects invalid institution query ${query.slice(0, 25)}`, async () => {
      await list("?" + query).expect(400);
    });
});
