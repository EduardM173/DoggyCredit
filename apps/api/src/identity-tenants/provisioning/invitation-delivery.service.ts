import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes, randomUUID } from "node:crypto";
import { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import { EmailSender, EmailDeliveryError } from "../../infrastructure/email/email-sender.js";
import { invitationHash } from "./provision-institution.service.js";
import { invitationEmail } from "./invitation-email.js";

@Injectable()
export class InvitationDeliveryService {
  private readonly logger = new Logger(InvitationDeliveryService.name);
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly config: ConfigService,
    private readonly email: EmailSender,
  ) {}
  async tick() {
    const now = new Date();
    const stale = new Date(
      now.getTime() - this.config.getOrThrow<number>("TENANT_PROVISIONING_LEASE_SECONDS") * 1000,
    );
    const max = this.config.getOrThrow<number>("MEMBERSHIP_INVITATION_MAX_SEND_ATTEMPTS");
    await this.db.client.membershipInvitation.updateMany({
      where: { sentAt: null, sendAttempts: { gte: max }, sendLockedAt: { lte: stale } },
      data: {
        sendLockedAt: null,
        sendLeaseToken: null,
        nextSendAttemptAt: null,
        lastSendErrorCode: "EMAIL_ATTEMPTS_EXHAUSTED",
      },
    });
    const eligible = {
      acceptedAt: null,
      invalidatedAt: null,
      sentAt: null,
      sendAttempts: { lt: max },
      nextSendAttemptAt: { lte: now },
      membership: { status: "INVITED" as const },
      OR: [{ sendLockedAt: null }, { sendLockedAt: { lte: stale } }],
    };
    const rows = await this.db.client.membershipInvitation.findMany({
      where: eligible,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 5,
      select: { id: true },
    });
    for (const row of rows) {
      const token = randomBytes(32).toString("base64url");
      const lease = randomUUID();
      const ttl = this.config.getOrThrow<number>("MEMBERSHIP_INVITATION_TTL_HOURS");
      const claimedAt = new Date();
      // Token plaintext only lives in this delivery call. A later recovery rotates it.
      const won = await this.db.client.membershipInvitation.updateMany({
        where: { id: row.id, ...eligible },
        data: {
          tokenHash: invitationHash(token),
          expiresAt: new Date(Date.now() + ttl * 3600000),
          version: { increment: 1 },
          sendAttempts: { increment: 1 },
          lastSendAttemptAt: claimedAt,
          sendLockedAt: claimedAt,
          sendLeaseToken: lease,
        },
      });
      if (!won.count) continue;
      const invitation = await this.db.client.membershipInvitation.findUniqueOrThrow({
        where: { id: row.id },
        include: {
          membership: {
            include: {
              user: { select: { email: true, fullName: true } },
              tenant: { select: { legalName: true } },
            },
          },
        },
      });
      if (invitation.sendLeaseToken !== lease || invitation.tokenHash !== invitationHash(token)) continue;
      const url = new URL("/activar-cuenta", this.config.getOrThrow<string>("PUBLIC_APP_URL"));
      url.hash = new URLSearchParams({ token }).toString();
      const message = {
        ...invitationEmail(
          invitation.membership.user.fullName,
          invitation.membership.tenant.legalName,
          url.toString(),
          ttl,
        ),
        to: invitation.membership.user.email,
        idempotencyKey: `membership-invitation/${invitation.id}/${invitation.version}`,
      };
      let delivered = false;
      let retryable = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          await this.email.send(message);
          delivered = true;
          break;
        } catch (error) {
          retryable = error instanceof EmailDeliveryError && error.retryable;
          if (!retryable) break;
        }
      }
      await this.db.client.membershipInvitation.updateMany({
        where: { id: row.id, sendLeaseToken: lease, tokenHash: invitationHash(token) },
        data: {
          sentAt: delivered ? new Date() : null,
          sendLockedAt: null,
          sendLeaseToken: null,
          lastSendErrorCode: delivered ? null : retryable ? "EMAIL_TEMPORARY" : "EMAIL_REJECTED",
          nextSendAttemptAt:
            !delivered && retryable && invitation.sendAttempts < max
              ? new Date(Date.now() + Math.min(300, 2 ** invitation.sendAttempts) * 1000)
              : null,
        },
      });
      if (!delivered)
        this.logger.warn("Membership invitation delivery incomplete; membership remains invited");
    }
  }
}
