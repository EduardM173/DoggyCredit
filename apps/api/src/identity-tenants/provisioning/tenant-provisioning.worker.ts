import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import { ProvisionInstitutionService } from "./provision-institution.service.js";
import { InvitationDeliveryService } from "./invitation-delivery.service.js";
import { provisioningFailure } from "./provisioning-failure.js";

@Injectable()
export class TenantProvisioningWorker implements OnModuleDestroy {
  private readonly logger = new Logger(TenantProvisioningWorker.name);
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = true;
  private running = false;
  private inFlight?: Promise<void>;
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly config: ConfigService,
    private readonly provisioner: ProvisionInstitutionService,
    private readonly delivery: InvitationDeliveryService,
  ) {}
  start() {
    if (!this.stopped || !this.config.get<boolean>("TENANT_PROVISIONING_ENABLED")) return;
    this.stopped = false;
    const loop = async () => {
      try {
        await this.tick();
      } catch {
        this.logger.warn("Provisioning poll unavailable; retrying next scheduled poll");
      } finally {
        if (!this.stopped)
          this.timer = setTimeout(
            () => {
              this.inFlight = loop();
            },
            this.config.getOrThrow<number>("TENANT_PROVISIONING_POLL_SECONDS") * 1000,
          );
      }
    };
    this.timer = setTimeout(() => {
      this.inFlight = loop();
    }, 0);
  }
  async onModuleDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.inFlight;
  }
  async claim() {
    const now = new Date();
    const stale = new Date(
      now.getTime() - this.config.getOrThrow<number>("TENANT_PROVISIONING_LEASE_SECONDS") * 1000,
    );
    const max = this.config.getOrThrow<number>("TENANT_PROVISIONING_MAX_ATTEMPTS");
    await this.db.client.tenantProvisioning.updateMany({
      where: { status: "PROCESSING", lockedAt: { lte: stale }, attemptCount: { gte: max } },
      data: {
        status: "FAILED_PERMANENT",
        lastErrorCode: "ATTEMPTS_EXHAUSTED",
        lockedAt: null,
        leaseToken: null,
      },
    });
    const eligible = {
      attemptCount: { lt: max },
      OR: [
        { status: "PENDING" as const },
        { status: "FAILED_RETRYABLE" as const, nextAttemptAt: { lte: now } },
        { status: "PROCESSING" as const, lockedAt: { lte: stale } },
      ],
    };
    const rows = await this.db.client.tenantProvisioning.findMany({
      where: eligible,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: 10,
      select: { id: true },
    });
    for (const row of rows) {
      const leaseToken = randomUUID();
      const won = await this.db.client.tenantProvisioning.updateMany({
        where: { id: row.id, ...eligible },
        data: {
          status: "PROCESSING",
          leaseToken,
          lockedAt: now,
          attemptCount: { increment: 1 },
          nextAttemptAt: null,
        },
      });
      if (won.count) return this.db.client.tenantProvisioning.findUniqueOrThrow({ where: { id: row.id } });
    }
    return null;
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      for (let i = 0; i < 5; i++) {
        const job = await this.claim();
        if (!job) break;
        try {
          await this.provisioner.provision(job.contractingId, job.leaseToken!);
        } catch (error) {
          const failure = provisioningFailure(error);
          const retry =
            failure.retryable &&
            job.attemptCount < this.config.getOrThrow<number>("TENANT_PROVISIONING_MAX_ATTEMPTS");
          await this.db.client.tenantProvisioning.updateMany({
            where: { id: job.id, status: "PROCESSING", leaseToken: job.leaseToken },
            data: {
              status: retry ? "FAILED_RETRYABLE" : "FAILED_PERMANENT",
              lastErrorCode: failure.code,
              lockedAt: null,
              leaseToken: null,
              nextAttemptAt: retry
                ? new Date(Date.now() + Math.min(300, 2 ** job.attemptCount) * 1000)
                : null,
            },
          });
          this.logger.warn(`Provisioning attempt ended: ${failure.code}`);
        }
      }
      await this.delivery.tick();
    } finally {
      this.running = false;
    }
  }
}
