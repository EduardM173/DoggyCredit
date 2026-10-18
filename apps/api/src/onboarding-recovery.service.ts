import { Injectable, NotFoundException } from "@nestjs/common";
import { DatabaseUnitOfWork } from "./infrastructure/prisma/database-unit-of-work.js";
import { AuditWriter } from "./audit/public.js";
import {
  InitialAdminRecoveryService,
  ProvisioningQueue,
  RequestContextReader,
  TenantProvisioningWorker,
} from "./identity-tenants/public.js";
import { ProvisioningPlans } from "./plans-metering/public.js";

@Injectable()
export class OnboardingRecoveryService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly plans: ProvisioningPlans,
    private readonly requests: RequestContextReader,
    private readonly queue: ProvisioningQueue,
    private readonly invitations: InitialAdminRecoveryService,
    private readonly worker: TenantProvisioningWorker,
    private readonly audit: AuditWriter,
  ) {}

  async retryProvisioning(contractingId: string, actorUserId: string) {
    await this.db.run(async () => {
      const eligibility = await this.plans.eligibility(contractingId);
      await this.requests.approved(eligibility.institutionRequestId);
      await this.queue.ensurePending(contractingId, eligibility.institutionRequestId);
      const retried = await this.queue.retry(contractingId, eligibility.institutionRequestId);
      if (retried)
        await this.audit.recordCommerce({
          action: "PROVISIONING_RETRY_REQUESTED",
          entityType: "Contracting",
          entityId: contractingId,
          actorUserId,
          actorKind: "OPERATOR",
        });
    });
    await this.worker.tick();
    return this.queue.progress(contractingId);
  }

  async resendInitialInvitation(contractingId: string, actorUserId: string) {
    const eligibility = await this.plans.eligibility(contractingId);
    await this.requests.approved(eligibility.institutionRequestId);
    const progress = await this.queue.progress(contractingId);
    if (!progress || progress.status !== "COMPLETED") throw new NotFoundException();
    await this.invitations.resend(eligibility.institutionRequestId, actorUserId);
    return this.queue.progress(contractingId);
  }
}
