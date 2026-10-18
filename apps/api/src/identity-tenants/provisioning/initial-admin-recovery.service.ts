import { ConflictException, HttpException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomBytes } from "node:crypto";
import { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import { AuditWriter } from "../../audit/public.js";
import { InvitationDeliveryService } from "./invitation-delivery.service.js";
import { invitationHash } from "./provision-institution.service.js";

@Injectable()
export class InitialAdminRecoveryService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly config: ConfigService,
    private readonly audit: AuditWriter,
    private readonly delivery: InvitationDeliveryService,
  ) {}

  async resend(requestId: string, actorUserId: string) {
    const invitationId = await this.db.run(async () => {
      await this.db.client
        .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`initial-invitation:${requestId}`},0))`;
      const request = await this.db.client.institutionRequest.findUnique({
        where: { id: requestId },
        select: { status: true, contactEmail: true },
      });
      const job = await this.db.client.tenantProvisioning.findFirst({
        where: { institutionRequestId: requestId, status: "COMPLETED", tenantId: { not: null } },
        select: { tenantId: true },
      });
      if (!request || request.status !== "APPROVED" || !job?.tenantId) throw new NotFoundException();
      const tenant = await this.db.client.tenant.findUnique({
        where: { id: job.tenantId },
        select: { createdFromRequestId: true, status: true },
      });
      const membership = await this.db.client.tenantMembership.findFirst({
        where: { tenantId: job.tenantId, isInitialAdmin: true, role: "INSTITUTION_ADMIN" },
        select: { id: true, status: true, user: { select: { email: true } } },
      });
      if (
        tenant?.createdFromRequestId !== requestId ||
        tenant.status !== "ACTIVE" ||
        !membership ||
        membership.user.email.toLowerCase() !== request.contactEmail.trim().toLowerCase()
      )
        throw new ConflictException("La identidad inicial no coincide con la solicitud aprobada.");
      if (membership.status !== "INVITED") throw new ConflictException("La cuenta inicial ya está activa.");
      const current = await this.db.client.membershipInvitation.findFirst({
        where: { tenantId: job.tenantId, membershipId: membership.id, acceptedAt: null, invalidatedAt: null },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      });
      if (current?.sendLockedAt) throw new ConflictException("La invitación está en proceso de envío.");
      if (current?.nextSendAttemptAt)
        throw new ConflictException("La invitación ya está programada para un nuevo intento.");
      const lastManual = await this.db.client.auditLog.findFirst({
        where: { entityType: "InstitutionRequest", entityId: requestId, action: "INITIAL_INVITATION_RESENT" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const remaining = lastManual
        ? Math.ceil((lastManual.createdAt.getTime() + 60_000 - Date.now()) / 1000)
        : 0;
      if (remaining > 0)
        throw new HttpException({ message: "Espera antes de reenviar.", retryAfterSeconds: remaining }, 429);
      if (current)
        await this.db.client.membershipInvitation.update({
          where: { id: current.id },
          data: { invalidatedAt: new Date(), nextSendAttemptAt: null },
        });
      const invitation = await this.db.client.membershipInvitation.create({
        data: {
          tenantId: job.tenantId,
          membershipId: membership.id,
          tokenHash: invitationHash(randomBytes(32).toString("base64url")),
          expiresAt: new Date(
            Date.now() + this.config.getOrThrow<number>("MEMBERSHIP_INVITATION_TTL_HOURS") * 3600000,
          ),
          nextSendAttemptAt: new Date(),
        },
      });
      await this.audit.recordCommerce({
        action: "INITIAL_INVITATION_RESENT",
        entityType: "InstitutionRequest",
        entityId: requestId,
        actorUserId,
        actorKind: "OPERATOR",
      });
      return invitation.id;
    });
    await this.delivery.deliver(invitationId);
    return { delivery: "REQUESTED" as const };
  }
}
