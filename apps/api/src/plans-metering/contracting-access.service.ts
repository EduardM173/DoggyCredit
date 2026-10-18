import { createHash, randomBytes } from "node:crypto";
import { ConflictException, HttpException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { RequestContextReader } from "../identity-tenants/public.js";
import { AuditWriter } from "../audit/public.js";
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
@Injectable()
export class ContractingAccessService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly requests: RequestContextReader,
    private readonly config: ConfigService,
    private readonly audit: AuditWriter,
  ) {}
  async queueEmail(requestId: string, actorUserId: string, manual = false) {
    return this.db.run(async () => {
      await this.db.client
        .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contract-access:${requestId}`},0))`;
      await this.requests.approved(requestId);
      if (await this.db.client.contracting.findUnique({ where: { requestId }, select: { id: true } }))
        throw new ConflictException("La contratación ya comenzó; no se puede emitir otro acceso.");
      const previous = await this.db.client.contractingCredential.findFirst({
        where: { requestId, kind: "ACCESS" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { createdAt: true, sendLockedAt: true, sentAt: true },
      });
      if (previous?.sendLockedAt) throw new ConflictException("El correo está en proceso de envío.");
      const remaining = previous ? Math.ceil((previous.createdAt.getTime() + 60_000 - Date.now()) / 1000) : 0;
      if (remaining > 0 && previous?.sentAt)
        throw new HttpException({ message: "Espera antes de reenviar.", retryAfterSeconds: remaining }, 429);
      if (manual) {
        const lastManual = await this.db.client.auditLog.findFirst({
          where: {
            entityType: "InstitutionRequest",
            entityId: requestId,
            action: "CONTRACTING_ACCESS_REQUEUED",
          },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
        const manualRemaining = lastManual
          ? Math.ceil((lastManual.createdAt.getTime() + 60_000 - Date.now()) / 1000)
          : 0;
        if (manualRemaining > 0)
          throw new HttpException(
            { message: "Espera antes de reenviar.", retryAfterSeconds: manualRemaining },
            429,
          );
      }
      await this.db.client.contractingCredential.updateMany({
        where: { requestId, revokedAt: null },
        data: { revokedAt: new Date(), nextSendAttemptAt: null },
      });
      const now = new Date();
      await this.db.client.contractingCredential.create({
        data: {
          requestId,
          kind: "ACCESS",
          tokenHash: digest(randomBytes(32).toString("base64url")),
          expiresAt: now,
          deliveryQueuedAt: now,
          nextSendAttemptAt: now,
        },
      });
      await this.audit.recordCommerce({
        action: manual ? "CONTRACTING_ACCESS_REQUEUED" : "CONTRACTING_ACCESS_QUEUED",
        entityType: "InstitutionRequest",
        entityId: requestId,
        actorUserId,
        actorKind: "OPERATOR",
      });
      return { delivery: "QUEUED" as const };
    });
  }
  async emailStatus(requestId: string) {
    await this.requests.approved(requestId);
    const credential = await this.db.client.contractingCredential.findFirst({
      where: { requestId, kind: "ACCESS", deliveryQueuedAt: { not: null } },
      orderBy: [{ deliveryQueuedAt: "desc" }, { id: "desc" }],
      select: {
        sentAt: true,
        revokedAt: true,
        nextSendAttemptAt: true,
        sendLockedAt: true,
        lastSendErrorCode: true,
      },
    });
    if (!credential) return { delivery: "NOT_QUEUED" as const };
    if (credential.revokedAt) return { delivery: "REPLACED" as const };
    return {
      delivery: credential.sentAt
        ? ("SENT" as const)
        : credential.nextSendAttemptAt || credential.sendLockedAt
          ? ("QUEUED" as const)
          : ("FAILED" as const),
      sentAt: credential.sentAt?.toISOString() ?? null,
      errorCode: credential.lastSendErrorCode,
      // Canal con el que el transporte aceptó el mensaje. Se deriva del transporte configurado
      // (no se persiste), para no afirmar una entrega externa cuando solo existe la bandeja de pruebas.
      channel: credential.sentAt ? this.deliveryChannel() : null,
    };
  }
  private deliveryChannel() {
    return this.config.get<string>("EMAIL_TRANSPORT") === "test_inbox"
      ? ("TEST_INBOX" as const)
      : ("SMTP" as const);
  }
  async issue(requestId: string, actorUserId: string) {
    return this.db.run(async () => {
      await this.db.client
        .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contract-access:${requestId}`},0))`;
      await this.requests.approved(requestId);
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(
        Date.now() + this.config.getOrThrow<number>("CONTRACTING_ACCESS_TOKEN_TTL_MINUTES") * 60000,
      );
      await this.db.client.contractingCredential.updateMany({
        where: { requestId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.db.client.contractingCredential.create({
        data: { requestId, kind: "ACCESS", tokenHash: digest(token), expiresAt },
      });
      await this.audit.recordCommerce({
        action: "CONTRACTING_ACCESS_ISSUED",
        entityType: "InstitutionRequest",
        entityId: requestId,
        actorUserId,
        actorKind: "OPERATOR",
      });
      const url = new URL("/contratacion", this.config.getOrThrow<string>("PUBLIC_APP_URL"));
      url.hash = `token=${token}`;
      return { url: url.toString(), expiresAt: expiresAt.toISOString() };
    });
  }
  async exchange(token: string) {
    return this.db.run(async () => {
      const access = await this.db.client.contractingCredential.findUnique({
        where: { tokenHash: digest(token) },
      });
      if (!access) throw new UnauthorizedException("El enlace no está disponible o venció.");
      await this.db.client
        .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contract-access:${access.requestId}`},0))`;
      await this.requests.approved(access.requestId);
      const consumed = await this.db.client.contractingCredential.updateMany({
        where: {
          id: access.id,
          kind: "ACCESS",
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1)
        throw new UnauthorizedException("El enlace ya se utilizó, fue reemplazado o venció.");
      const session = randomBytes(32).toString("base64url");
      const expiresAt = new Date(
        Date.now() + this.config.getOrThrow<number>("CONTRACTING_SESSION_TTL_MINUTES") * 60000,
      );
      await this.db.client.contractingCredential.create({
        data: { requestId: access.requestId, kind: "SESSION", tokenHash: digest(session), expiresAt },
      });
      return { token: session, expiresAt };
    });
  }
  async authenticate(token?: string) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException("Abre un enlace de contratación válido.");
    const session = await this.db.client.contractingCredential.findUnique({
      where: { tokenHash: digest(token) },
    });
    if (!session || session.kind !== "SESSION" || session.revokedAt || session.expiresAt <= new Date())
      throw new UnauthorizedException("La sesión de contratación venció. Solicita un nuevo enlace.");
    await this.requests.approved(session.requestId);
    return session.requestId;
  }
  async lockApproved(requestId: string) {
    await this.db.client
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contracting:${requestId}`},0))`;
    const context = await this.requests.approved(requestId);
    if (context.status !== "APPROVED") throw new ConflictException();
    return context;
  }
}
