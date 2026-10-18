import { Injectable } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";

@Injectable()
export class ProvisioningQueue {
  constructor(private readonly db: DatabaseUnitOfWork) {}
  async ensurePending(contractingId: string, institutionRequestId: string): Promise<void> {
    await this.db.client.tenantProvisioning.upsert({
      where: { contractingId },
      create: { contractingId, institutionRequestId },
      update: {},
    });
  }

  async progress(contractingId: string) {
    const job = await this.db.client.tenantProvisioning.findUnique({
      where: { contractingId },
      select: { status: true, lastErrorCode: true, nextAttemptAt: true, tenantId: true },
    });
    if (!job) return null;
    if (job.status !== "COMPLETED" || !job.tenantId)
      return {
        status: job.status,
        errorCode: job.lastErrorCode,
        nextAttemptAt: job.nextAttemptAt?.toISOString() ?? null,
        tenant: null,
        activation: null,
      };
    const membership = await this.db.client.tenantMembership.findFirst({
      where: { tenantId: job.tenantId, isInitialAdmin: true, role: "INSTITUTION_ADMIN" },
      select: {
        status: true,
        tenant: { select: { slug: true, legalName: true } },
        invitations: {
          where: { acceptedAt: null, invalidatedAt: null },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: {
            sentAt: true,
            expiresAt: true,
            nextSendAttemptAt: true,
            sendLockedAt: true,
            lastSendErrorCode: true,
          },
        },
      },
    });
    const invitation = membership?.invitations[0];
    return {
      status: job.status,
      errorCode: null,
      nextAttemptAt: null,
      tenant: membership?.tenant ?? null,
      activation: membership
        ? {
            status: membership.status,
            delivery:
              membership.status === "ACTIVE"
                ? "ACTIVATED"
                : invitation?.sentAt
                  ? invitation.expiresAt > new Date()
                    ? "SENT"
                    : "EXPIRED"
                  : invitation?.nextSendAttemptAt || invitation?.sendLockedAt
                    ? "QUEUED"
                    : "FAILED",
            sentAt: invitation?.sentAt?.toISOString() ?? null,
          }
        : null,
    };
  }

  async retry(contractingId: string, institutionRequestId: string) {
    return this.db.run(async () => {
      await this.db.client
        .$queryRaw`SELECT id FROM "TenantProvisioning" WHERE "contractingId"=${contractingId}::uuid FOR UPDATE`;
      const job = await this.db.client.tenantProvisioning.findUnique({ where: { contractingId } });
      if (!job || job.institutionRequestId !== institutionRequestId) return false;
      if (job.status === "COMPLETED") return false;
      if (job.status !== "FAILED_PERMANENT" && job.status !== "FAILED_RETRYABLE") return false;
      await this.db.client.tenantProvisioning.update({
        where: { id: job.id },
        data: {
          status: "PENDING",
          attemptCount: 0,
          nextAttemptAt: null,
          lockedAt: null,
          leaseToken: null,
          lastErrorCode: null,
        },
      });
      return true;
    });
  }
}
