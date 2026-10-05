import { createHash, randomBytes } from "node:crypto";
import { BadRequestException, HttpException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { EmailSender } from "../../infrastructure/email/email-sender.js";
import type { VerificationDelivery, VerifiedRequest } from "./email-verification.contract.js";
import { verificationEmail } from "./verification-email.js";

const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const invalid = () =>
  new BadRequestException(
    "El enlace no es válido, venció o ya fue utilizado. Usa el correo más reciente o solicita otro desde la confirmación de tu solicitud.",
  );

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly sender: EmailSender,
    private readonly config: ConfigService,
  ) {}

  async send(requestId: string): Promise<VerificationDelivery> {
    const cooldown = this.config.getOrThrow<number>("EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS");
    const ttl = this.config.getOrThrow<number>("EMAIL_VERIFICATION_TOKEN_TTL_MINUTES");
    const token = randomBytes(32).toString("base64url");
    const reserved = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`email-verification:${requestId}`}, 0))`;
      const request = await tx.institutionRequest.findUnique({ where: { id: requestId } });
      if (!request || request.status !== "EMAIL_PENDING") return null;
      const now = new Date();
      const latest = await tx.emailVerificationToken.findFirst({
        where: { requestId },
        orderBy: { createdAt: "desc" },
      });
      if (latest) {
        const lastAttempt = Math.max(latest.createdAt.getTime(), latest.sentAt?.getTime() ?? 0);
        const remaining = Math.ceil((lastAttempt + cooldown * 1000 - now.getTime()) / 1000);
        if (remaining > 0)
          throw new HttpException(
            { message: "Espera antes de solicitar otro correo.", retryAfterSeconds: remaining },
            429,
          );
      }
      // Expired reservations cannot activate late; a previously SENT link remains usable.
      await tx.emailVerificationToken.updateMany({
        where: { requestId, sentAt: null, usedAt: null, invalidatedAt: null },
        data: { invalidatedAt: now },
      });
      const saved = await tx.emailVerificationToken.create({
        data: {
          requestId,
          tokenHash: digest(token),
          expiresAt: new Date(now.getTime() + ttl * 60000),
        },
      });
      return { id: saved.id, email: request.contactEmail };
    });
    if (!reserved) return { emailDelivery: "UNAVAILABLE", retryAfterSeconds: 0 };

    try {
      const url = new URL("/verificar-correo", this.config.getOrThrow<string>("PUBLIC_APP_URL"));
      url.searchParams.set("token", token);
      url.searchParams.set("requestId", requestId);
      await this.sender.send({
        to: reserved.email,
        ...verificationEmail(url.toString(), ttl),
        idempotencyKey: `institution-request-verification/${requestId}/${reserved.id}`,
      });
      const activated = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`email-verification:${requestId}`}, 0))`;
        const request = await tx.institutionRequest.findUnique({ where: { id: requestId } });
        const now = new Date();
        if (request?.status !== "EMAIL_PENDING") {
          await tx.emailVerificationToken.updateMany({
            where: { id: reserved.id },
            data: { invalidatedAt: now },
          });
          return false;
        }
        const activated = await tx.emailVerificationToken.updateMany({
          where: {
            id: reserved.id,
            sentAt: null,
            usedAt: null,
            invalidatedAt: null,
            expiresAt: { gt: now },
          },
          data: { sentAt: now },
        });
        if (!activated.count) return false;
        await tx.emailVerificationToken.updateMany({
          where: {
            requestId,
            id: { not: reserved.id },
            usedAt: null,
            invalidatedAt: null,
          },
          data: { invalidatedAt: now },
        });
        return true;
      });
      return {
        emailDelivery: activated ? "SENT" : "UNAVAILABLE",
        retryAfterSeconds: activated ? cooldown : 0,
      };
    } catch {
      // A failed or ambiguous external send must never revoke the previously active link.
      await this.prisma.emailVerificationToken
        .updateMany({ where: { id: reserved.id, sentAt: null }, data: { invalidatedAt: new Date() } })
        .catch(() => undefined);
      this.logger.warn("Verification email could not be confirmed; retry is available after cooldown.");
      return { emailDelivery: "FAILED", retryAfterSeconds: cooldown };
    }
  }

  async verify(token: string): Promise<VerifiedRequest> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw invalid();
    const found = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: digest(token) },
      select: { requestId: true },
    });
    if (!found) throw invalid();
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`email-verification:${found.requestId}`}, 0))`;
      const now = new Date();
      const request = await tx.institutionRequest.findUnique({ where: { id: found.requestId } });
      if (request?.status !== "EMAIL_PENDING") throw invalid();
      const consumed = await tx.emailVerificationToken.updateMany({
        where: {
          tokenHash: digest(token),
          usedAt: null,
          invalidatedAt: null,
          sentAt: { not: null },
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) throw invalid();
      const updated = await tx.institutionRequest.updateMany({
        where: { id: request.id, status: "EMAIL_PENDING" },
        data: { status: "PENDING_REVIEW", emailVerifiedAt: now },
      });
      if (updated.count !== 1) throw invalid();
      return { contactEmail: request.contactEmail, status: "PENDING_REVIEW" };
    });
  }
}
