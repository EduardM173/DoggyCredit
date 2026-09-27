import { Injectable, Logger } from "@nestjs/common";
import { DatabaseUnitOfWork } from "./infrastructure/prisma/database-unit-of-work.js";
import { RequestReviewService } from "./identity-tenants/public.js";
import { ContractingAccessService, ContractingEmailDeliveryService } from "./plans-metering/public.js";

@Injectable()
export class ContractingApprovalService {
  private readonly logger = new Logger(ContractingApprovalService.name);
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly review: RequestReviewService,
    private readonly access: ContractingAccessService,
    private readonly delivery: ContractingEmailDeliveryService,
  ) {}

  async approve(id: string, actorUserId: string) {
    const detail = await this.db.run(async () => {
      const result = await this.review.decide(id, actorUserId, "APPROVED");
      await this.access.queueEmail(id);
      return result;
    });
    await this.tryDelivery(id);
    return detail;
  }

  async resend(id: string) {
    await this.access.queueEmail(id);
    await this.tryDelivery(id);
    return this.access.emailStatus(id);
  }

  private async tryDelivery(id: string) {
    try {
      await this.delivery.tick(id);
    } catch {
      this.logger.warn("Contracting email remains queued after immediate attempt");
    }
  }
}
