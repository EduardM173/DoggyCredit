/* eslint-disable @typescript-eslint/no-explicit-any */
import { resolve } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { config } from "dotenv";

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

import { describe, expect, it, beforeAll, afterAll } from "@jest/globals";
import { BadRequestException, ConflictException } from "@nestjs/common";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  PrismaClient,
  InstitutionType,
  UserStatus,
  TenantRole,
} from "../generated/prisma/client.js";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { PrismaService } from "../infrastructure/prisma/prisma.service.js";
/* eslint-disable-next-line no-restricted-imports */
import { AuditService } from "../audit/audit.service.js";
import { ActivationService } from "./activation/activation.service.js";
import { InitialAdminRecoveryService } from "./provisioning/initial-admin-recovery.service.js";
import { InvitationDeliveryService } from "./provisioning/invitation-delivery.service.js";
import { TeamService } from "./institution-auth/team.service.js";
import { ProvisioningQueue } from "./provisioning/provisioning-queue.js";
import { createHash } from "node:crypto";
const invitationHash = (token: string) => createHash("sha256").update(token).digest("hex");
import type { EmailSender, EmailMessage, EmailDeliveryReceipt } from "../infrastructure/email/email-sender.js";
import type { TenantContext } from "./institution-auth/tenant-context.guard.js";

class InMemoryEmailSender implements EmailSender {
  messages: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<EmailDeliveryReceipt> {
    this.messages.push(message);
    return { channel: "TEST_INBOX" };
  }

  popLastToken(): string | null {
    const last = this.messages[this.messages.length - 1];
    if (!last) return null;
    const match = last.text.match(/token=([A-Za-z0-9_-]{43})/);
    return match ? match[1] : null;
  }
}

class MockConfigService {
  private values: Record<string, any> = {
    MEMBERSHIP_INVITATION_TTL_HOURS: 48,
    MEMBERSHIP_INVITATION_MAX_SEND_ATTEMPTS: 5,
    TENANT_PROVISIONING_LEASE_SECONDS: 30,
    TENANT_PROVISIONING_POLL_SECONDS: 5,
    PUBLIC_APP_URL: "http://localhost:3000",
  };

  getOrThrow<T = any>(key: string): T {
    if (!(key in this.values)) throw new Error(`Missing config: ${key}`);
    return this.values[key] as T;
  }
}

describe("S4-HF-08 — Recuperar invitación vencida sin soporte SQL", () => {
  const databaseUrl =
    process.env.TEST_DATABASE_URL ||
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@localhost:5435/doggycredit?schema=public";
  const pool = new Pool({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const prismaService = prisma as unknown as PrismaService;
  let db: DatabaseUnitOfWork;
  let audit: AuditService;
  let emailSender: InMemoryEmailSender;
  let configService: MockConfigService;
  let deliveryService: InvitationDeliveryService;
  let recoveryService: InitialAdminRecoveryService;
  let activationService: ActivationService;
  let teamService: TeamService;
  let provisioningQueue: ProvisioningQueue;

  const testRunId = randomUUID().slice(0, 8);
  const operatorUserId = randomUUID();

  beforeAll(async () => {
    await prisma.$connect();
    db = new DatabaseUnitOfWork(prismaService);
    audit = new AuditService(db);
    emailSender = new InMemoryEmailSender();
    configService = new MockConfigService();
    deliveryService = new InvitationDeliveryService(db, configService as any, emailSender);
    recoveryService = new InitialAdminRecoveryService(db, configService as any, audit, deliveryService);
    activationService = new ActivationService(db, audit);
    teamService = new TeamService(db, audit, configService as any, deliveryService);
    provisioningQueue = new ProvisioningQueue(db);

    await prisma.user.create({
      data: {
        id: operatorUserId,
        email: `operator-${testRunId}@doggycredit.com`,
        fullName: "Operador de Plataforma",
        status: UserStatus.ACTIVE,
      },
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("Escenario 1 (Administrador Inicial): expira enlace inicial, rechaza activación, se recupera vía operador y activa sin soporte SQL", async () => {
    const suffix = `${testRunId}-init`;
    const contactEmail = `admin-${suffix}@bancoprueba.test`;
    const tenantSlug = `banco-prueba-${suffix}`;

    // 1. Crear solicitud aprobada y tenant provisionado
    const request = await prisma.institutionRequest.create({
      data: {
        institutionName: `Banco Prueba ${suffix}`,
        institutionType: InstitutionType.BANK,
        contactName: "Ana Administradora",
        contactEmail,
        contactPhone: "70012345",
        contactRole: "Gerente General",
        taxId: `NIT-${suffix}`,
        status: "APPROVED",
      },
    });

    const tenant = await prisma.tenant.create({
      data: {
        slug: tenantSlug,
        legalName: `Banco Prueba ${suffix} S.A.`,
        institutionType: InstitutionType.BANK,
        taxId: `NIT-${suffix}`,
        status: "ACTIVE",
        createdFromRequestId: request.id,
      },
    });

    const user = await prisma.user.create({
      data: {
        email: contactEmail,
        fullName: "Ana Administradora",
        status: UserStatus.INVITED,
      },
    });

    const membership = await prisma.tenantMembership.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        role: TenantRole.INSTITUTION_ADMIN,
        isInitialAdmin: true,
        status: "INVITED",
      },
    });

    const plan = await prisma.plan.findFirstOrThrow();
    const contracting = await prisma.contracting.create({
      data: {
        requestId: request.id,
        confirmedPlanId: plan.id,
        planCodeSnapshot: plan.code,
        planNameSnapshot: plan.name,
        priceSnapshot: plan.price ?? 0,
        currencySnapshot: plan.currency ?? "BOB",
        billingPeriodSnapshot: "MONTHLY",
        requiresPaymentSnapshot: false,
        status: "CONFIRMED",
      },
    });

    await prisma.tenantProvisioning.create({
      data: {
        contractingId: contracting.id,
        institutionRequestId: request.id,
        tenantId: tenant.id,
        status: "COMPLETED",
        attemptCount: 1,
      },
    });

    // 2. Crear y entregar la primera invitación con token A
    const tokenA = randomBytes(32).toString("base64url");
    const initialInvitation = await prisma.membershipInvitation.create({
      data: {
        tenantId: tenant.id,
        membershipId: membership.id,
        tokenHash: invitationHash(tokenA),
        expiresAt: new Date(Date.now() + 48 * 3600000),
        sentAt: new Date(),
        sendAttempts: 1,
      },
    });

    // 3. Simular que el enlace de activación expiró
    await prisma.membershipInvitation.update({
      where: { id: initialInvitation.id },
      data: { expiresAt: new Date(Date.now() - 3600000) }, // Expiró hace 1 hora
    });

    // 4. Salida observada: El usuario intenta previsualizar o activar con el token expirado
    await expect(activationService.preview(tokenA)).rejects.toThrow(
      new BadRequestException("El enlace de activación venció."),
    );
    await expect(
      activationService.activate(tokenA, "ContraseñaSegura15Caract!"),
    ).rejects.toThrow(new BadRequestException("El enlace de activación venció."));

    // 5. El operador consulta el estado y ve la invitación como EXPIRED en el panel
    const progress = await provisioningQueue.progress(contracting.id);
    expect(progress?.activation?.delivery).toBe("EXPIRED");
    expect(progress?.activation?.status).toBe("INVITED");

    // 6. RECUPERACIÓN SIN SQL: El operador llama a resendInitialInvitation
    const resendResult = await recoveryService.resend(request.id, operatorUserId);
    expect(resendResult.delivery).toBe("REQUESTED");

    // 7. Verificar efectos en base de datos sin manipulación manual
    const previousInvitation = await prisma.membershipInvitation.findUniqueOrThrow({
      where: { id: initialInvitation.id },
    });
    expect(previousInvitation.invalidatedAt).not.toBeNull();

    // Nueva invitación activa creada
    const newInvitation = await prisma.membershipInvitation.findFirstOrThrow({
      where: { tenantId: tenant.id, membershipId: membership.id, invalidatedAt: null },
    });
    expect(newInvitation.id).not.toBe(initialInvitation.id);
    expect(newInvitation.tokenHash).not.toBe(initialInvitation.tokenHash);
    expect(newInvitation.expiresAt.getTime()).toBeGreaterThan(Date.now() + 47 * 3600000);

    // Auditoría de reenvío registrada
    const auditResend = await prisma.auditLog.findFirst({
      where: {
        entityType: "InstitutionRequest",
        entityId: request.id,
        action: "INITIAL_INVITATION_RESENT",
      },
    });
    expect(auditResend).not.toBeNull();
    expect(auditResend?.actorUserId).toBe(operatorUserId);

    // 8. El token A antiguo sigue siendo rechazado
    await expect(activationService.preview(tokenA)).rejects.toThrow(BadRequestException);

    // 9. El nuevo token B entregado por correo es válido y permite la activación
    const tokenB = emailSender.popLastToken();
    expect(tokenB).not.toBeNull();
    expect(tokenB).not.toBe(tokenA);

    const previewB = await activationService.preview(tokenB!);
    expect(previewB.valid).toBe(true);
    expect(previewB.role).toBe(TenantRole.INSTITUTION_ADMIN);
    expect(previewB.requiresCredentialSetup).toBe(true);
    expect(previewB.institution.name).toBe(tenant.legalName);

    // Activación exitosa con contraseña robusta
    const activationResult = await activationService.activate(
      tokenB!,
      "ContraseñaSegura15Caract!",
    );
    expect(activationResult.activated).toBe(true);

    // 10. Membresía y usuario quedan en ACTIVE
    const activatedMembership = await prisma.tenantMembership.findUniqueOrThrow({
      where: { id: membership.id },
    });
    expect(activatedMembership.status).toBe("ACTIVE");

    const activatedUser = await prisma.user.findUniqueOrThrow({
      where: { id: user.id },
    });
    expect(activatedUser.status).toBe("ACTIVE");
    expect(activatedUser.passwordHash).not.toBeNull();

    // Auditoría de activación registrada
    const auditActivation = await prisma.auditLog.findFirst({
      where: {
        tenantId: tenant.id,
        action: "MEMBERSHIP_ACTIVATED",
      },
    });
    expect(auditActivation).not.toBeNull();

    // 11. Intentar volver a usar el token B ahora arroja que ya fue utilizado
    await expect(
      activationService.activate(tokenB!, "ContraseñaSegura15Caract!"),
    ).rejects.toThrow(new BadRequestException("El enlace ya fue utilizado."));
  });

  it("Escenario 2 (Analista de Equipo): expira invitación de analista, el administrador institucional reenvía y se activa sin soporte SQL", async () => {
    const suffix = `${testRunId}-analyst`;
    const adminEmail = `admin-equipo-${suffix}@bancoprueba.test`;
    const analystEmail = `analista-${suffix}@bancoprueba.test`;
    const tenantSlug = `banco-equipo-${suffix}`;

    // 1. Setup Tenant con Administrador activo
    const tenant = await prisma.tenant.create({
      data: {
        slug: tenantSlug,
        legalName: `Banco Equipo ${suffix} S.A.`,
        institutionType: InstitutionType.BANK,
        taxId: `NIT-EQ-${suffix}`,
        status: "ACTIVE",
      },
    });

    const adminUser = await prisma.user.create({
      data: {
        email: adminEmail,
        fullName: "Administrador Activo",
        status: UserStatus.ACTIVE,
        passwordHash: "$argon2id$v=19$m=19456,t=2,p=1$fakeadminhash",
      },
    });

    const adminMembership = await prisma.tenantMembership.create({
      data: {
        tenantId: tenant.id,
        userId: adminUser.id,
        role: TenantRole.INSTITUTION_ADMIN,
        isInitialAdmin: true,
        status: "ACTIVE",
      },
    });

    const adminCtx: TenantContext = {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.legalName,
      userId: adminUser.id,
      userName: adminUser.fullName,
      membershipId: adminMembership.id,
      role: TenantRole.INSTITUTION_ADMIN,
      institutionType: tenant.institutionType,
      taxId: tenant.taxId,
    };

    // 2. El administrador invita a un analista
    const inviteResult = await teamService.invite(adminCtx, analystEmail, "ANALYST");
    expect(inviteResult.emailSent).toBe(true);

    const tokenA = emailSender.popLastToken();
    expect(tokenA).not.toBeNull();

    const analystMembership = await prisma.tenantMembership.findFirstOrThrow({
      where: { tenantId: tenant.id, user: { email: analystEmail } },
      include: { invitations: true },
    });
    expect(analystMembership.status).toBe("INVITED");
    const invitationA = analystMembership.invitations[0];

    // 3. Expirar la invitación
    await prisma.membershipInvitation.update({
      where: { id: invitationA.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    // 4. Comprobar que token A venció
    await expect(activationService.preview(tokenA!)).rejects.toThrow(
      new BadRequestException("El enlace de activación venció."),
    );

    // 5. RECUPERACIÓN SIN SQL: Administrador presiona "Reenviar" desde el panel de Equipo
    const resendResult = await teamService.resend(adminCtx, invitationA.id);
    expect(resendResult.emailSent).toBe(true);

    // Verificar evento de auditoría
    const auditResend = await prisma.auditLog.findFirst({
      where: {
        tenantId: tenant.id,
        action: "ANALYST_INVITATION_RESENT",
      },
    });
    expect(auditResend).not.toBeNull();

    // 6. Token A sigue rechazado
    await expect(activationService.preview(tokenA!)).rejects.toThrow(BadRequestException);

    // 7. Token B es válido y activa la membresía del analista
    const tokenB = emailSender.popLastToken();
    expect(tokenB).not.toBeNull();
    expect(tokenB).not.toBe(tokenA);

    const previewB = await activationService.preview(tokenB!);
    expect(previewB.valid).toBe(true);
    expect(previewB.role).toBe(TenantRole.ANALYST);

    const activateB = await activationService.activate(tokenB!, "ContraseñaAnalistaValida15!");
    expect(activateB.activated).toBe(true);

    const activatedAnalyst = await prisma.tenantMembership.findUniqueOrThrow({
      where: { id: analystMembership.id },
    });
    expect(activatedAnalyst.status).toBe("ACTIVE");
  });

  it("Escenario 3 (Seguridad): impide reenvío si la membresía ya fue activada", async () => {
    const suffix = `${testRunId}-active`;
    const email = `activo-${suffix}@bancoprueba.test`;

    const tenant = await prisma.tenant.create({
      data: {
        slug: `banco-activo-${suffix}`,
        legalName: `Banco Activo ${suffix}`,
        institutionType: InstitutionType.BANK,
        taxId: `NIT-ACT-${suffix}`,
        status: "ACTIVE",
      },
    });

    const user = await prisma.user.create({
      data: {
        email,
        fullName: "Usuario Ya Activo",
        status: UserStatus.ACTIVE,
      },
    });

    const membership = await prisma.tenantMembership.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        role: TenantRole.ANALYST,
        status: "ACTIVE", // Ya está activo
      },
    });

    const invitation = await prisma.membershipInvitation.create({
      data: {
        tenantId: tenant.id,
        membershipId: membership.id,
        tokenHash: invitationHash(randomBytes(32).toString("base64url")),
        expiresAt: new Date(Date.now() + 48 * 3600000),
      },
    });

    const adminUser = await prisma.user.create({
      data: {
        email: `admin-${suffix}@bancoprueba.test`,
        fullName: "Admin Activo",
        status: UserStatus.ACTIVE,
      },
    });

    const adminMembership = await prisma.tenantMembership.create({
      data: {
        tenantId: tenant.id,
        userId: adminUser.id,
        role: TenantRole.INSTITUTION_ADMIN,
        status: "ACTIVE",
      },
    });

    const adminCtx: TenantContext = {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.legalName,
      userId: adminUser.id,
      userName: adminUser.fullName,
      membershipId: adminMembership.id,
      role: TenantRole.INSTITUTION_ADMIN,
      institutionType: tenant.institutionType,
      taxId: tenant.taxId,
    };

    // Intentar reenviar sobre membresía ya activa arroja ConflictException
    await expect(teamService.resend(adminCtx, invitation.id)).rejects.toThrow(ConflictException);
  });
});
