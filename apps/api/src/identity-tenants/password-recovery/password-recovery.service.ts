import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, HttpException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import { EmailSender } from "../../infrastructure/email/email-sender.js";
import { activationPassword } from "../activation/activation-password.js";
import { hashPassword } from "../auth/password-hashing.js";
import { passwordRecoveryEmail } from "./password-recovery-email.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const invalid = () => new BadRequestException("El enlace no es válido, venció o ya fue utilizado.");
const genericMessage =
  "Si existe una cuenta asociada a este correo, recibirás instrucciones para recuperar el acceso.";
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

@Injectable()
export class PasswordRecoveryService {
  private readonly logger = new Logger(PasswordRecoveryService.name);
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly sender: EmailSender,
    private readonly config: ConfigService,
  ) {}

  private async allow(key: string, max: number, windowMinutes: number) {
    const keyHash = digest(key);
    const cutoff = new Date(Date.now() - windowMinutes * 60_000);
    const rows = await this.db.client.$queryRaw<{ attempts: number }[]>`
      INSERT INTO "RecoveryRateLimit" ("keyHash", "windowStart", "attempts")
      VALUES (${keyHash}, NOW(), 1)
      ON CONFLICT ("keyHash") DO UPDATE SET
        "windowStart" = CASE WHEN "RecoveryRateLimit"."windowStart" < ${cutoff}
          THEN NOW() ELSE "RecoveryRateLimit"."windowStart" END,
        "attempts" = CASE WHEN "RecoveryRateLimit"."windowStart" < ${cutoff}
          THEN 1 ELSE "RecoveryRateLimit"."attempts" + 1 END
      RETURNING "attempts"`;
    return rows[0].attempts <= max;
  }

  async request(emailInput: string, remoteAddress: string) {
    const started = Date.now();
    const email = emailInput.trim().toLowerCase();
    try {
      const [ipAllowed, emailAllowed] = await Promise.all([
        this.allow(`request-ip:${remoteAddress}`, 30, 15),
        this.allow(`request-email:${email}`, 3, 15),
      ]);
      if (ipAllowed && emailAllowed) {
        const user = await this.db.client.user.findUnique({
          where: { email },
          select: { id: true, email: true, status: true, passwordHash: true, platformRole: true },
        });
        if (user?.passwordHash && user.status === "ACTIVE")
          void this.issue(user).catch(() => this.logger.warn("Password recovery issuance failed"));
        await this.db.client.auditLog.create({
          data: { action: "PASSWORD_RESET_REQUESTED", entityType: "PasswordRecovery" },
        });
      }
    } catch {
      // Neither database nor recipient-specific delivery errors may identify an account.
      this.logger.warn("Password recovery request could not be completed");
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, 600 - (Date.now() - started))));
    return { message: genericMessage };
  }

  private async issue(user: { id: string; email: string; platformRole: string | null }) {
    const token = randomBytes(32).toString("base64url");
    const ttl = this.config.getOrThrow<number>("PASSWORD_RESET_TOKEN_TTL_MINUTES");
    const reserved = await this.db.run(async () => {
      await this.db.client
        .$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`password-reset:${user.id}`}, 0))`;
      const recent = await this.db.client.passwordResetToken.findFirst({
        where: { userId: user.id, createdAt: { gt: new Date(Date.now() - 60_000) } },
      });
      if (recent) return null;
      const row = await this.db.client.passwordResetToken.create({
        data: { userId: user.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + ttl * 60_000) },
      });
      await this.db.client.auditLog.create({
        data: { action: "PASSWORD_RESET_ISSUED", entityType: "PasswordResetToken", entityId: row.id },
      });
      return row;
    });
    if (!reserved) return;
    const url = new URL("/restablecer-contrasena", this.config.getOrThrow<string>("PUBLIC_APP_URL"));
    if (user.platformRole === "OPERATOR" || user.platformRole === "PLATFORM_ADMIN")
      url.searchParams.set("from", "internal");
    url.hash = new URLSearchParams({ token }).toString();
    try {
      await this.sender.send({
        to: user.email,
        ...passwordRecoveryEmail(url.toString(), ttl),
        idempotencyKey: `password-recovery/${reserved.id}`,
      });
      await this.db.run(async () => {
        await this.db.client
          .$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`password-reset:${user.id}`}, 0))`;
        const now = new Date();
        const marked = await this.db.client.passwordResetToken.updateMany({
          where: { id: reserved.id, sentAt: null, invalidatedAt: null, usedAt: null, expiresAt: { gt: now } },
          data: { sentAt: now },
        });
        if (marked.count) {
          await this.db.client.passwordResetToken.updateMany({
            where: { userId: user.id, id: { not: reserved.id }, invalidatedAt: null, usedAt: null },
            data: { invalidatedAt: now },
          });
        }
      });
    } catch {
      await this.db.client.passwordResetToken.updateMany({
        where: { id: reserved.id, sentAt: null },
        data: { invalidatedAt: new Date() },
      });
      await this.db.client.auditLog.create({
        data: {
          action: "PASSWORD_RESET_DELIVERY_FAILED",
          entityType: "PasswordResetToken",
          entityId: reserved.id,
        },
      });
      this.logger.warn("Password recovery email could not be confirmed");
    }
  }

  async preview(token: string, remoteAddress: string) {
    if (!(await this.allow(`preview-ip:${remoteAddress}`, 60, 15)))
      throw new HttpException("Demasiados intentos. Inténtalo más tarde.", 429);
    if (!tokenPattern.test(token)) {
      await this.db.client.auditLog.create({ data: { action: "PASSWORD_RESET_INVALID", entityType: "PasswordRecovery" } });
      throw invalid();
    }
    const row = await this.db.client.passwordResetToken.findUnique({
      where: { tokenHash: digest(token) },
      select: {
        expiresAt: true,
        sentAt: true,
        usedAt: true,
        invalidatedAt: true,
        user: { select: { status: true, passwordHash: true } },
      },
    });
    if (
      !row ||
      !row.sentAt ||
      row.usedAt ||
      row.invalidatedAt ||
      row.expiresAt <= new Date() ||
      row.user.status !== "ACTIVE" ||
      !row.user.passwordHash
    ) {
      await this.db.client.auditLog.create({
        data: { action: "PASSWORD_RESET_INVALID", entityType: "PasswordRecovery" },
      });
      throw invalid();
    }
    return { valid: true };
  }

  async complete(token: string, password: string, confirmation: string, remoteAddress: string) {
    if (!(await this.allow(`complete-ip:${remoteAddress}`, 30, 15)))
      throw new HttpException("Demasiados intentos. Inténtalo más tarde.", 429);
    if (!tokenPattern.test(token)) {
      await this.db.client.auditLog.create({ data: { action: "PASSWORD_RESET_INVALID", entityType: "PasswordRecovery" } });
      throw invalid();
    }
    if (password.normalize("NFC") !== confirmation.normalize("NFC"))
      throw new BadRequestException("Las contraseñas no coinciden.");
    const normalized = activationPassword(password);
    const tokenHash = digest(token);
    const encoded = await hashPassword(normalized);
    try {
      const result = await this.db.run(async () => {
        const found = await this.db.client.passwordResetToken.findUnique({ where: { tokenHash } });
        if (!found) throw invalid();
        await this.db.client
          .$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`password-reset:${found.userId}`}, 0))`;
        const now = new Date();
        const row = await this.db.client.passwordResetToken.findUnique({
          where: { tokenHash },
          include: { user: true },
        });
        if (
          !row ||
          !row.sentAt ||
          row.usedAt ||
          row.invalidatedAt ||
          row.expiresAt <= now ||
          row.user.status !== "ACTIVE" ||
          !row.user.passwordHash
        ) {
          throw invalid();
        }
        const consumed = await this.db.client.passwordResetToken.updateMany({
          where: {
            id: row.id,
            sentAt: { not: null },
            usedAt: null,
            invalidatedAt: null,
            expiresAt: { gt: now },
          },
          data: { usedAt: now },
        });
        if (consumed.count !== 1) throw invalid();
        await this.db.client.user.update({
          where: { id: row.userId },
          data: { passwordHash: encoded, passwordChangedAt: now },
        });
        await this.db.client.passwordResetToken.updateMany({
          where: { userId: row.userId, id: { not: row.id }, usedAt: null, invalidatedAt: null },
          data: { invalidatedAt: now },
        });
        await this.db.client.institutionSession.updateMany({
          where: { userId: row.userId, revokedAt: null },
          data: { revokedAt: now },
        });
        await this.db.client.adminSession.updateMany({
          where: { userId: row.userId, revokedAt: null },
          data: { revokedAt: now },
        });
        await this.db.client.auditLog.create({
          data: {
            actorUserId: row.userId,
            action: "PASSWORD_RESET_COMPLETED",
            entityType: "User",
            entityId: row.userId,
          },
        });
        return { completed: true };
      });
      return result;
    } catch (error) {
      if (error instanceof BadRequestException && error.message === invalid().message)
        await this.db.client.auditLog
          .create({ data: { action: "PASSWORD_RESET_INVALID", entityType: "PasswordRecovery" } })
          .catch(() => undefined);
      throw error;
    }
  }
}
