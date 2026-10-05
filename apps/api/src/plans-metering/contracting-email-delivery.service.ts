import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { EmailDeliveryError, EmailSender } from "../infrastructure/email/email-sender.js";
import { RequestContextReader } from "../identity-tenants/public.js";
import { contractingEmail } from "./contracting-email.js";

const digest = (token: string) => createHash("sha256").update(token).digest("hex");

@Injectable()
export class ContractingEmailDeliveryService implements OnModuleDestroy {
  private readonly logger = new Logger(ContractingEmailDeliveryService.name);
  private timer?: ReturnType<typeof setTimeout>;
  private inFlight?: Promise<void>;
  private stopped = true;
  private running = false;
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly config: ConfigService,
    private readonly email: EmailSender,
    private readonly requests: RequestContextReader,
  ) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    const loop = async () => {
      try {
        await this.tick();
      } catch {
        this.logger.warn("Contracting email poll unavailable; retrying next poll");
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

  async tick(requestId?: string) {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const stale = new Date(now.getTime() - 60_000);
      await this.db.client.contractingCredential.updateMany({
        where: {
          deliveryQueuedAt: { not: null },
          sentAt: null,
          revokedAt: null,
          sendAttempts: { gte: 5 },
          sendLockedAt: { lte: stale },
        },
        data: {
          sendLockedAt: null,
          sendLeaseToken: null,
          nextSendAttemptAt: null,
          lastSendErrorCode: "EMAIL_ATTEMPTS_EXHAUSTED",
        },
      });
      const eligible = {
        kind: "ACCESS" as const,
        ...(requestId ? { requestId } : {}),
        deliveryQueuedAt: { not: null },
        sentAt: null,
        usedAt: null,
        revokedAt: null,
        sendAttempts: { lt: 5 },
        nextSendAttemptAt: { lte: now },
        OR: [{ sendLockedAt: null }, { sendLockedAt: { lte: stale } }],
      };
      const rows = await this.db.client.contractingCredential.findMany({
        where: eligible,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: requestId ? 1 : 5,
        select: { id: true },
      });
      for (const row of rows) {
        const token = randomBytes(32).toString("base64url");
        const lease = randomUUID();
        const ttl = this.config.getOrThrow<number>("CONTRACTING_ACCESS_TOKEN_TTL_MINUTES");
        const won = await this.db.client.contractingCredential.updateMany({
          where: { id: row.id, ...eligible },
          data: {
            tokenHash: digest(token),
            expiresAt: new Date(Date.now() + ttl * 60_000),
            sendVersion: { increment: 1 },
            sendAttempts: { increment: 1 },
            sendLockedAt: new Date(),
            sendLeaseToken: lease,
          },
        });
        if (!won.count) continue;
        const credential = await this.db.client.contractingCredential.findUniqueOrThrow({
          where: { id: row.id },
          select: { requestId: true, sendVersion: true, sendAttempts: true },
        });
        let delivered = false;
        let retryable = false;
        try {
          const recipient = await this.requests.approved(credential.requestId);
          const url = new URL("/contratacion", this.config.getOrThrow<string>("PUBLIC_APP_URL"));
          url.hash = new URLSearchParams({ token }).toString();
          await this.email.send({
            ...contractingEmail(recipient.contactName, recipient.institutionName, url.toString(), ttl),
            to: recipient.contactEmail,
            idempotencyKey: `contracting-access/${row.id}/${credential.sendVersion}`,
          });
          delivered = true;
        } catch (error) {
          retryable = error instanceof EmailDeliveryError && error.retryable;
        }
        await this.db.client.contractingCredential.updateMany({
          where: { id: row.id, sendLeaseToken: lease, tokenHash: digest(token), revokedAt: null },
          data: {
            sentAt: delivered ? new Date() : null,
            sendLockedAt: null,
            sendLeaseToken: null,
            lastSendErrorCode: delivered ? null : retryable ? "EMAIL_TEMPORARY" : "EMAIL_REJECTED",
            nextSendAttemptAt:
              !delivered && retryable && credential.sendAttempts < 5
                ? new Date(Date.now() + Math.min(300, 2 ** credential.sendAttempts) * 1000)
                : null,
          },
        });
        if (!delivered) this.logger.warn("Contracting access email delivery incomplete");
      }
    } finally {
      this.running = false;
    }
  }
}
