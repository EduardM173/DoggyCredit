import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import { ProvisioningPlans, ProvisioningEligibilityError } from "../../plans-metering/public.js";
import { AuditWriter } from "../../audit/public.js";
import { PreparationProducts } from "../../recommendations/public.js";

export const invitationHash = (token: string) => createHash("sha256").update(token).digest("hex");
export const institutionSlug = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 42)
    .replace(/-$/, "") || "institucion";

@Injectable()
export class ProvisionInstitutionService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly plans: ProvisioningPlans,
    private readonly audit: AuditWriter,
    private readonly config: ConfigService,
    private readonly products: PreparationProducts,
  ) {}
  async provision(contractingId: string, leaseToken: string) {
    return this.db.run(async () => {
      // Fence the worker for the entire short transaction, including completion.
      await this.db.client
        .$queryRaw`SELECT id FROM "TenantProvisioning" WHERE "contractingId"=${contractingId}::uuid FOR UPDATE`;
      const job = await this.db.client.tenantProvisioning.findUniqueOrThrow({ where: { contractingId } });
      if (job.status === "COMPLETED") return job.tenantId;
      if (job.status !== "PROCESSING" || job.leaseToken !== leaseToken) return null;
      const eligibility = await this.plans.eligibility(contractingId);
      if (eligibility.institutionRequestId !== job.institutionRequestId)
        throw new ProvisioningEligibilityError("REQUEST_LINK_CONFLICT");
      await this.db.client
        .$queryRaw`SELECT id FROM "InstitutionRequest" WHERE id=${job.institutionRequestId}::uuid FOR UPDATE`;
      const request = await this.db.client.institutionRequest.findUnique({
        where: { id: job.institutionRequestId },
      });
      if (!request || request.status !== "APPROVED")
        throw new ProvisioningEligibilityError("REQUEST_NOT_APPROVED");
      const base = institutionSlug(request.institutionName);
      const email = request.contactEmail.trim().toLowerCase();
      for (const lock of [`provision-email:${email}`, `provision-slug:${base}`])
        await this.db.client.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock},0))`;
      let tenant = await this.db.client.tenant.findUnique({ where: { createdFromRequestId: request.id } });
      if (!tenant) {
        if (await this.db.client.tenant.findUnique({ where: { taxId: request.taxId }, select: { id: true } }))
          throw new ProvisioningEligibilityError("TENANT_TAX_ID_CONFLICT");
        const candidates = [
          base,
          `${base}-${request.id.slice(0, 8)}`,
          `${base}-${request.id.replace(/-/g, "")}`,
        ];
        let slug: string | undefined;
        for (const candidate of candidates)
          if (
            !(await this.db.client.tenant.findUnique({ where: { slug: candidate }, select: { id: true } }))
          ) {
            slug = candidate;
            break;
          }
        if (!slug) throw new ProvisioningEligibilityError("SLUG_CONFLICT");
        tenant = await this.db.client.tenant.create({
          data: {
            slug,
            legalName: request.institutionName,
            taxId: request.taxId,
            institutionType: request.institutionType,
            createdFromRequestId: request.id,
            status: "ACTIVE",
          },
        });
      } else if (tenant.taxId !== request.taxId)
        throw new ProvisioningEligibilityError("TENANT_REQUEST_CONFLICT");
      if (this.config.get<string>("NODE_ENV") === "development")
        await this.products.ensureDemoProducts(tenant.id);
      let user = await this.db.client.user.findFirst({
        where: { email: { equals: email, mode: "insensitive" } },
      });
      if (!user)
        user = await this.db.client.user.create({
          data: { email, fullName: request.contactName, status: "INVITED" },
        });
      let membership = await this.db.client.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
      });
      if (membership) {
        if (
          membership.role !== "INSTITUTION_ADMIN" ||
          !membership.isInitialAdmin ||
          membership.status !== "INVITED"
        )
          throw new ProvisioningEligibilityError("INITIAL_MEMBERSHIP_CONFLICT");
      } else {
        if (
          await this.db.client.tenantMembership.findFirst({
            where: { tenantId: tenant.id, isInitialAdmin: true },
            select: { id: true },
          })
        )
          throw new ProvisioningEligibilityError("INITIAL_ADMIN_CONFLICT");
        membership = await this.db.client.tenantMembership.create({
          data: {
            tenantId: tenant.id,
            userId: user.id,
            role: "INSTITUTION_ADMIN",
            status: "INVITED",
            isInitialAdmin: true,
          },
        });
      }
      await this.plans.ensureSubscription(contractingId, tenant.id);
      const invitation = await this.db.client.membershipInvitation.findFirst({
        where: { membershipId: membership.id, tenantId: tenant.id, acceptedAt: null, invalidatedAt: null },
      });
      if (!invitation)
        await this.db.client.membershipInvitation.create({
          data: {
            tenantId: tenant.id,
            membershipId: membership.id,
            tokenHash: invitationHash(randomBytes(32).toString("base64url")),
            expiresAt: new Date(
              Date.now() + this.config.getOrThrow<number>("MEMBERSHIP_INVITATION_TTL_HOURS") * 3600000,
            ),
            nextSendAttemptAt: new Date(),
          },
        });
      await this.audit.recordProvisioning({
        tenantId: tenant.id,
        contractingId,
        membershipId: membership.id,
        planId: eligibility.confirmedPlanId,
      });
      await this.db.client.tenantProvisioning.update({
        where: { id: job.id },
        data: {
          status: "COMPLETED",
          tenantId: tenant.id,
          completedAt: new Date(),
          lockedAt: null,
          leaseToken: null,
          lastErrorCode: null,
          nextAttemptAt: null,
        },
      });
      return tenant.id;
    });
  }
}
