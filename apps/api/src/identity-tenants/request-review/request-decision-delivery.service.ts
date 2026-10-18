import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import { EmailDeliveryError, EmailSender } from "../../infrastructure/email/email-sender.js";
import { AuditWriter } from "../../audit/public.js";
import { rejectionEmail } from "./rejection-email.js";

@Injectable()
export class RequestDecisionDeliveryService implements OnModuleDestroy {
  private readonly logger = new Logger(RequestDecisionDeliveryService.name);
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<void>;
  private stopped = true;

  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly sender: EmailSender,
    private readonly audit: AuditWriter,
  ) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const loop = async () => {
      try {
        await this.tick();
      } catch {
        this.logger.warn("Request decision email poll unavailable; retrying next poll");
      } finally {
        if (!this.stopped) this.timer = setTimeout(() => (this.inFlight = loop()), 5000);
      }
    };
    this.timer = setTimeout(() => (this.inFlight = loop()), 0);
  }

  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.inFlight;
  }

  async status(requestId: string) {
    const request = await this.db.client.institutionRequest.findUnique({
      where: { id: requestId },
      select: { status: true },
    });
    if (!request || request.status !== "REJECTED") throw new NotFoundException();
    const notice = await this.db.client.requestDecisionNotice.findUnique({ where: { requestId } });
    return {
      delivery: notice?.sentAt
        ? "SENT"
        : notice?.nextSendAttemptAt || notice?.sendLockedAt
          ? "QUEUED"
          : "FAILED",
      sentAt: notice?.sentAt?.toISOString() ?? null,
    };
  }

  async resend(requestId: string, actorUserId: string) {
    await this.db.run(async () => {
      await this.db.client
        .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`rejection-notice:${requestId}`},0))`;
      const request = await this.db.client.institutionRequest.findUnique({
        where: { id: requestId },
        select: { status: true },
      });
      if (!request || request.status !== "REJECTED") throw new NotFoundException();
      const notice = await this.db.client.requestDecisionNotice.findUnique({ where: { requestId } });
      if (!notice) throw new ConflictException("No hay una notificación para recuperar.");
      if (notice.sendLockedAt) throw new ConflictException("El correo está en proceso de envío.");
      if (notice.nextSendAttemptAt)
        throw new ConflictException("El correo ya está programado para un nuevo intento.");
      const lastManual = await this.db.client.auditLog.findFirst({
        where: {
          entityType: "InstitutionRequest",
          entityId: requestId,
          action: "REQUEST_REJECTION_NOTICE_REQUEUED",
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const remaining = lastManual
        ? Math.ceil((lastManual.createdAt.getTime() + 60_000 - Date.now()) / 1000)
        : 0;
      if (remaining > 0)
        throw new HttpException({ message: "Espera antes de reenviar.", retryAfterSeconds: remaining }, 429);
      await this.db.client.requestDecisionNotice.update({
        where: { requestId },
        data: {
          sentAt: null,
          sendAttempts: 0,
          version: { increment: 1 },
          nextSendAttemptAt: new Date(),
          lastSendErrorCode: null,
        },
      });
      await this.audit.recordRequestNotice({
        requestId,
        actorUserId,
        action: "REQUEST_REJECTION_NOTICE_REQUEUED",
      });
    });
    return this.status(requestId);
  }

  async tick(requestId?: string) {
    const now = new Date();
    const stale = new Date(now.getTime() - 60_000);
    const eligible = {
      ...(requestId ? { requestId } : {}),
      sentAt: null,
      sendAttempts: { lt: 5 },
      nextSendAttemptAt: { lte: now },
      OR: [{ sendLockedAt: null }, { sendLockedAt: { lte: stale } }],
      request: { status: "REJECTED" as const },
    };
    const rows = await this.db.client.requestDecisionNotice.findMany({
      where: eligible,
      take: requestId ? 1 : 5,
      select: { id: true },
    });
    for (const row of rows) {
      const lease = randomUUID();
      const won = await this.db.client.requestDecisionNotice.updateMany({
        where: { id: row.id, ...eligible },
        data: { sendLockedAt: now, sendLeaseToken: lease, sendAttempts: { increment: 1 } },
      });
      if (!won.count) continue;
      const notice = await this.db.client.requestDecisionNotice.findUniqueOrThrow({
        where: { id: row.id },
        include: { request: { select: { contactEmail: true, contactName: true, institutionName: true } } },
      });
      let delivered = false;
      let retryable = false;
      try {
        await this.sender.send({
          ...rejectionEmail(notice.request.contactName, notice.request.institutionName),
          to: notice.request.contactEmail,
          idempotencyKey: `request-rejected/${notice.requestId}/${notice.version}/${notice.sendAttempts}`,
        });
        delivered = true;
      } catch (error) {
        retryable = error instanceof EmailDeliveryError && error.retryable;
      }
      await this.db.run(async () => {
        const changed = await this.db.client.requestDecisionNotice.updateMany({
          where: { id: row.id, sendLeaseToken: lease, sentAt: null },
          data: {
            sentAt: delivered ? new Date() : null,
            sendLockedAt: null,
            sendLeaseToken: null,
            lastSendErrorCode: delivered ? null : retryable ? "EMAIL_TEMPORARY" : "EMAIL_REJECTED",
            nextSendAttemptAt:
              !delivered && retryable && notice.sendAttempts < 5
                ? new Date(Date.now() + Math.min(300, 2 ** notice.sendAttempts) * 1000)
                : null,
          },
        });
        if (changed.count)
          await this.audit.recordRequestNotice({
            requestId: notice.requestId,
            action: delivered ? "REQUEST_REJECTION_NOTICE_SENT" : "REQUEST_REJECTION_NOTICE_FAILED",
          });
      });
    }
  }
}
