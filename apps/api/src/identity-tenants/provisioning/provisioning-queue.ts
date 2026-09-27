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
}
