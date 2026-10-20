import { createHash, randomBytes } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import { AuditWriter } from "../../audit/public.js";
import { EmailSender } from "../../infrastructure/email/email-sender.js";
import { activationPassword } from "../activation/activation-password.js";
import { hashPassword } from "../auth/password-hashing.js";

const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");

@Injectable()
export class PlatformTeamService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly email: EmailSender,
    private readonly config: ConfigService,
    private readonly audit: AuditWriter,
  ) {}

  private async recordRejected(
    error: unknown,
    actorUserId: string | undefined,
    entityId: string,
    action: string,
  ): Promise<never> {
    if (
      error instanceof ConflictException ||
      error instanceof ForbiddenException ||
      error instanceof NotFoundException
    ) {
      await this.audit.recordPlatformTeamEvent({
        actorUserId,
        action,
        entityType: "User",
        entityId,
        metadata: { result: "REJECTED", reasonCode: String(error.getStatus()) },
      });
    }
    throw error;
  }

  async list() {
    const users = await this.db.client.user.findMany({
      where: {
        OR: [
          { platformRole: { not: null } },
          { platformAccessStatus: { not: "ACTIVE" } },
          { platformInvitations: { some: { acceptedAt: null, invalidatedAt: null } } },
        ],
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        platformRole: true,
        platformAccessStatus: true,
        platformInvitations: {
          where: { acceptedAt: null, invalidatedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, expiresAt: true, sentAt: true, sendAttemptedAt: true, sendErrorCode: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return users.map((user) => ({
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.platformRole ?? "OPERATOR",
      status:
        user.status === "BLOCKED" ? "BLOCKED" : user.platformRole ? user.platformAccessStatus : "INVITED",
      invitation: user.platformInvitations[0] ?? null,
    }));
  }

  async invite(actorUserId: string, email: string, fullName: string) {
    const normalized = email.trim().toLowerCase();
    const name = fullName.trim();
    if (!name) throw new BadRequestException("Ingresa el nombre del operador.");
    const token = newToken();
    const row = await this.db
      .run(async () => {
        const tx = this.db.client;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`operator-invites:${actorUserId}`}))`;
        const recent = await this.audit.countRecentPlatformInvitations(
          actorUserId,
          new Date(Date.now() - 3600000),
        );
        if (recent >= 30)
          throw new HttpException("Límite de invitaciones alcanzado. Intenta más tarde.", 429);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${normalized}))`;
        let user = await tx.user.findFirst({ where: { email: { equals: normalized, mode: "insensitive" } } });
        if (user) {
          await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id}::uuid FOR UPDATE`;
          if (user.status === "BLOCKED" || user.platformRole || user.platformAccessStatus !== "ACTIVE")
            throw new ConflictException("Esta identidad no admite una invitación interna.");
          const pending = await tx.platformInvitation.findFirst({
            where: { userId: user.id, acceptedAt: null, invalidatedAt: null },
          });
          if (pending) throw new ConflictException("Ya existe una invitación. Usa Reenviar.");
        } else {
          user = await tx.user.create({ data: { email: normalized, fullName: name, status: "INVITED" } });
        }
        const invitation = await tx.platformInvitation.create({
          data: {
            userId: user.id,
            tokenHash: digest(token),
            expiresAt: new Date(
              Date.now() + this.config.getOrThrow<number>("MEMBERSHIP_INVITATION_TTL_HOURS") * 3600000,
            ),
          },
        });
        await this.audit.recordPlatformTeamEvent({
          actorUserId,
          action: "OPERATOR_INVITATION_CREATED",
          entityType: "PlatformInvitation",
          entityId: invitation.id,
          metadata: { targetUserId: user.id, role: "OPERATOR", result: "PENDING_DELIVERY" },
        });
        return { invitation, user };
      })
      .catch((error: unknown) =>
        this.recordRejected(error, actorUserId, actorUserId, "OPERATOR_INVITATION_REJECTED"),
      );
    return this.deliver(actorUserId, row.invitation.id, row.user.email, row.user.fullName, token);
  }

  async resend(actorUserId: string, userId: string) {
    const token = newToken();
    const row = await this.db
      .run(async () => {
        const tx = this.db.client;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`operator-invites:${actorUserId}`}))`;
        const recent = await this.audit.countRecentPlatformInvitations(
          actorUserId,
          new Date(Date.now() - 3600000),
        );
        if (recent >= 30)
          throw new HttpException("Límite de invitaciones alcanzado. Intenta más tarde.", 429);
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId}::uuid FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException("Operador no encontrado.");
        if (user.platformRole || user.status === "BLOCKED" || user.platformAccessStatus !== "ACTIVE")
          throw new ConflictException("La invitación ya no puede reenviarse.");
        const current = await tx.platformInvitation.findFirst({
          where: { userId, acceptedAt: null, invalidatedAt: null },
          orderBy: { createdAt: "desc" },
        });
        if (!current) throw new ConflictException("No hay invitación pendiente.");
        if (
          current.sentAt &&
          current.sendAttemptedAt &&
          Date.now() - current.sendAttemptedAt.getTime() < 60_000
        )
          throw new ConflictException("Espera un minuto antes de reenviar.");
        await tx.platformInvitation.update({
          where: { id: current.id },
          data: { invalidatedAt: new Date() },
        });
        const invitation = await tx.platformInvitation.create({
          data: {
            userId,
            tokenHash: digest(token),
            expiresAt: new Date(
              Date.now() + this.config.getOrThrow<number>("MEMBERSHIP_INVITATION_TTL_HOURS") * 3600000,
            ),
          },
        });
        await this.audit.recordPlatformTeamEvent({
          actorUserId,
          action: "OPERATOR_INVITATION_RESENT",
          entityType: "PlatformInvitation",
          entityId: invitation.id,
          metadata: { targetUserId: userId, replacedInvitationId: current.id, result: "PENDING_DELIVERY" },
        });
        return { invitation, user };
      })
      .catch((error: unknown) =>
        this.recordRejected(error, actorUserId, userId, "OPERATOR_INVITATION_REJECTED"),
      );
    return this.deliver(actorUserId, row.invitation.id, row.user.email, row.user.fullName, token);
  }

  private async deliver(actorUserId: string, invitationId: string, to: string, name: string, token: string) {
    const url = `${this.config.getOrThrow<string>("WEB_ORIGIN")}/activar-operador#token=${token}`;
    const ttl = this.config.getOrThrow<number>("MEMBERSHIP_INVITATION_TTL_HOURS");
    let delivered = false;
    try {
      await this.email.send({
        to,
        subject: "Invitación a DoggyCredit como operador",
        text: `Hola ${name}. Te invitamos como operador interno de DoggyCredit. Activa el acceso: ${url}\nEl enlace es de un solo uso y vence en ${ttl} horas.`,
        html: `<p>Hola.</p><p>Te invitamos como operador interno de DoggyCredit.</p><p><a href="${url}">Activar acceso</a></p><p>El enlace vence en ${ttl} horas.</p>`,
        idempotencyKey: `platform-invitation:${invitationId}`,
      });
      delivered = true;
    } catch {
      // Only a generic delivery result is persisted. Never log the URL or token.
    }
    await this.db.run(async () => {
      const tx = this.db.client;
      await tx.platformInvitation.update({
        where: { id: invitationId },
        data: {
          sendAttemptedAt: new Date(),
          sentAt: delivered ? new Date() : null,
          sendErrorCode: delivered ? null : "DELIVERY_FAILED",
        },
      });
      await this.audit.recordPlatformTeamEvent({
        actorUserId,
        action: delivered ? "OPERATOR_INVITATION_SENT" : "OPERATOR_INVITATION_FAILED",
        entityType: "PlatformInvitation",
        entityId: invitationId,
        metadata: { result: delivered ? "ACCEPTED_BY_TRANSPORT" : "FAILED" },
      });
    });
    return { invitationId, delivery: delivered ? "ACCEPTED_BY_TRANSPORT" : "FAILED" };
  }

  private async findValid(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new BadRequestException("Enlace inválido.");
    const row = await this.db.client.platformInvitation.findUnique({
      where: { tokenHash: digest(token) },
      include: { user: true },
    });
    if (
      !row ||
      row.invalidatedAt ||
      row.acceptedAt ||
      !row.sentAt ||
      row.expiresAt <= new Date() ||
      row.user.status === "BLOCKED" ||
      row.user.platformRole ||
      row.user.platformAccessStatus !== "ACTIVE"
    )
      throw new BadRequestException("Este enlace no está disponible. Solicita uno nuevo.");
    return row;
  }

  async preview(token: string) {
    const row = await this.findValid(token);
    return {
      valid: true,
      role: "OPERATOR",
      name: row.user.fullName,
      email: row.user.email,
      requiresCredentialSetup: !row.user.passwordHash,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  async accept(token: string, password?: string) {
    const initial = await this.findValid(token).catch(async (error: unknown) => {
      if (/^[A-Za-z0-9_-]{43}$/.test(token)) {
        const known = await this.db.client.platformInvitation.findUnique({
          where: { tokenHash: digest(token) },
          select: { id: true },
        });
        if (known)
          await this.audit.recordPlatformTeamEvent({
            action: "OPERATOR_INVITATION_REJECTED",
            entityType: "PlatformInvitation",
            entityId: known.id,
            metadata: { result: "REJECTED", reasonCode: "UNAVAILABLE" },
          });
      }
      throw error;
    });
    if (!initial.user.passwordHash && typeof password !== "string")
      throw new BadRequestException("Define una contraseña.");
    if (initial.user.passwordHash && password !== undefined)
      throw new BadRequestException("La cuenta ya tiene credenciales.");
    const encoded = password === undefined ? null : await hashPassword(activationPassword(password));
    return this.db
      .run(async () => {
        const tx = this.db.client;
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${initial.userId}::uuid FOR UPDATE`;
        const row = await tx.platformInvitation.findUnique({
          where: { id: initial.id },
          include: { user: true },
        });
        if (
          !row ||
          row.acceptedAt ||
          row.invalidatedAt ||
          !row.sentAt ||
          row.expiresAt <= new Date() ||
          row.user.status === "BLOCKED" ||
          row.user.platformRole ||
          row.user.platformAccessStatus !== "ACTIVE"
        )
          throw new ConflictException("El enlace ya no está disponible.");
        if (Boolean(row.user.passwordHash) !== !encoded)
          throw new ConflictException("La identidad cambió. Actualiza la página.");
        const now = new Date();
        await tx.platformInvitation.update({ where: { id: row.id }, data: { acceptedAt: now } });
        await tx.user.update({
          where: { id: row.userId },
          data: {
            platformRole: "OPERATOR",
            status: "ACTIVE",
            emailVerifiedAt: row.user.emailVerifiedAt ?? now,
            ...(encoded ? { passwordHash: encoded, passwordChangedAt: now } : {}),
          },
        });
        await this.audit.recordPlatformTeamEvent({
          actorUserId: row.userId,
          action: "OPERATOR_INVITATION_ACCEPTED",
          entityType: "PlatformInvitation",
          entityId: row.id,
          metadata: { role: "OPERATOR", from: "INVITED", to: "ACTIVE" },
        });
        return { activated: true };
      })
      .catch((error: unknown) =>
        this.recordRejected(error, undefined, initial.userId, "OPERATOR_ACTIVATION_REJECTED"),
      );
  }

  async changeAccess(actorUserId: string, targetUserId: string, action: "SUSPENDED" | "REVOKED") {
    return this.db
      .run(async () => {
        const tx = this.db.client;
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${targetUserId}::uuid FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id: targetUserId } });
        if (!user) throw new NotFoundException("Operador no encontrado.");
        if (user.platformRole === "PLATFORM_ADMIN" || user.id === actorUserId)
          throw new ForbiddenException("No se puede retirar al administrador de plataforma.");
        const pending = await tx.platformInvitation.count({
          where: { userId: user.id, acceptedAt: null, invalidatedAt: null },
        });
        if (user.platformRole !== "OPERATOR" && !pending)
          throw new ConflictException("No existe acceso interno para retirar.");
        if (user.platformAccessStatus === action) return { status: action, unchanged: true };
        if (user.platformAccessStatus !== "ACTIVE") throw new ConflictException("El acceso ya fue retirado.");
        if (action === "SUSPENDED" && user.platformRole !== "OPERATOR")
          throw new ConflictException("No se puede suspender una invitación pendiente.");
        await tx.user.update({ where: { id: user.id }, data: { platformAccessStatus: action } });
        await tx.adminSession.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.platformInvitation.updateMany({
          where: { userId: user.id, acceptedAt: null, invalidatedAt: null },
          data: { invalidatedAt: new Date() },
        });
        await this.audit.recordPlatformTeamEvent({
          actorUserId,
          action: action === "SUSPENDED" ? "OPERATOR_SUSPENDED" : "OPERATOR_REVOKED",
          entityType: "User",
          entityId: user.id,
          metadata: {
            role: user.platformRole ?? "OPERATOR",
            from: user.platformRole ? "ACTIVE" : "INVITED",
            to: action,
          },
        });
        return { status: action, unchanged: false };
      })
      .catch((error: unknown) =>
        this.recordRejected(error, actorUserId, targetUserId, "OPERATOR_ACCESS_CHANGE_REJECTED"),
      );
  }

  async reactivate(actorUserId: string, targetUserId: string) {
    return this.db
      .run(async () => {
        const tx = this.db.client;
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${targetUserId}::uuid FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id: targetUserId } });
        if (!user || user.platformRole !== "OPERATOR") throw new NotFoundException("Operador no encontrado.");
        if (user.status !== "ACTIVE" || user.platformAccessStatus !== "SUSPENDED")
          throw new ConflictException("Solo puede reactivarse un operador suspendido.");
        await tx.user.update({ where: { id: user.id }, data: { platformAccessStatus: "ACTIVE" } });
        await this.audit.recordPlatformTeamEvent({
          actorUserId,
          action: "OPERATOR_REACTIVATED",
          entityType: "User",
          entityId: user.id,
          metadata: { role: "OPERATOR", from: "SUSPENDED", to: "ACTIVE" },
        });
        return { status: "ACTIVE" };
      })
      .catch((error: unknown) =>
        this.recordRejected(error, actorUserId, targetUserId, "OPERATOR_ACCESS_CHANGE_REJECTED"),
      );
  }
}
