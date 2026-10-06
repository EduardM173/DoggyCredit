import { randomBytes } from "node:crypto";
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import { AuditWriter } from "../../audit/public.js";
import { invitationHash } from "../provisioning/provision-institution.service.js";
import { InvitationDeliveryService } from "../provisioning/invitation-delivery.service.js";
import type { TenantContext } from "./tenant-context.guard.js";

@Injectable()
export class TeamService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly audit: AuditWriter,
    private readonly config: ConfigService,
    private readonly delivery: InvitationDeliveryService,
  ) {}

  private admin(ctx: TenantContext) {
    if (ctx.role !== "INSTITUTION_ADMIN")
      throw new ForbiddenException("Solo un administrador institucional puede administrar el equipo.");
  }

  async list(ctx: TenantContext) {
    this.admin(ctx);
    const rows = await this.db.client.tenantMembership.findMany({
      where: { tenantId: ctx.tenantId, status: { in: ["ACTIVE", "INVITED"] } },
      select: {
        id: true,
        role: true,
        status: true,
        isInitialAdmin: true,
        user: { select: { fullName: true, email: true } },
        invitations: {
          where: { acceptedAt: null, invalidatedAt: null },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 1,
          select: { id: true, sentAt: true, expiresAt: true, lastSendErrorCode: true },
        },
      },
      orderBy: [{ isInitialAdmin: "desc" }, { createdAt: "asc" }],
    });
    return {
      tenant: { name: ctx.tenantName, slug: ctx.tenantSlug },
      members: rows.map((row) => ({
        id: row.id,
        name: row.user.fullName === row.user.email ? null : row.user.fullName,
        email: row.user.email,
        role: row.role,
        status: row.status,
        isInitialAdmin: row.isInitialAdmin,
        invitation: row.status === "INVITED" ? (row.invitations[0] ?? null) : null,
      })),
    };
  }

  private async lockActor(ctx: TenantContext) {
    await this.db.client
      .$queryRaw`SELECT id FROM "TenantMembership" WHERE id=${ctx.membershipId}::uuid FOR UPDATE`;
    const actor = await this.db.client.tenantMembership.findFirst({
      where: {
        id: ctx.membershipId,
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        role: "INSTITUTION_ADMIN",
        status: "ACTIVE",
        tenant: { status: "ACTIVE" },
      },
      select: { id: true },
    });
    if (!actor) throw new ForbiddenException("Ya no tienes acceso para administrar este equipo.");
  }

  async invite(ctx: TenantContext, email: string) {
    this.admin(ctx);
    const normalized = email.trim().toLowerCase();
    const invitationId = await this.db.run(async () => {
      await this.lockActor(ctx);
      // One global identity per email, including concurrent invitations to different tenants.
      await this.db.client
        .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`team-user:${normalized}`},0))`;
      let user = await this.db.client.user.findFirst({
        where: { email: { equals: normalized, mode: "insensitive" } },
        select: { id: true, status: true },
      });
      if (user?.status === "BLOCKED")
        throw new ConflictException("Esta cuenta no puede recibir invitaciones.");
      if (!user)
        user = await this.db.client.user.create({
          data: { email: normalized, fullName: normalized, status: "INVITED" },
          select: { id: true, status: true },
        });
      const existing = await this.db.client.tenantMembership.findUnique({
        where: { tenantId_userId: { tenantId: ctx.tenantId, userId: user.id } },
        select: { status: true },
      });
      if (existing)
        throw new ConflictException(
          existing.status === "ACTIVE"
            ? "Esta persona ya tiene acceso a la institución."
            : existing.status === "INVITED"
              ? "Ya hay una invitación pendiente para este correo. Puedes reenviarla desde Equipo."
              : "Esta persona ya tiene una membresía en la institución.",
        );
      const membership = await this.db.client.tenantMembership.create({
        data: { tenantId: ctx.tenantId, userId: user.id, role: "ANALYST", status: "INVITED" },
      });
      const invitation = await this.db.client.membershipInvitation.create({
        data: {
          tenantId: ctx.tenantId,
          membershipId: membership.id,
          tokenHash: invitationHash(randomBytes(32).toString("base64url")),
          expiresAt: new Date(
            Date.now() + this.config.getOrThrow<number>("MEMBERSHIP_INVITATION_TTL_HOURS") * 3600000,
          ),
          nextSendAttemptAt: new Date(),
        },
      });
      await this.audit.recordTeamInvitation({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        invitationId: invitation.id,
        action: "ANALYST_INVITATION_CREATED",
      });
      return invitation.id;
    });
    const emailSent = await this.delivery.deliver(invitationId);
    return { emailSent, team: await this.list(ctx) };
  }

  async resend(ctx: TenantContext, invitationId: string) {
    this.admin(ctx);
    await this.db.run(async () => {
      await this.lockActor(ctx);
      const invitation = await this.db.client.membershipInvitation.findFirst({
        where: { id: invitationId, tenantId: ctx.tenantId, membership: { role: "ANALYST" } },
        select: { membershipId: true },
      });
      if (!invitation) throw new NotFoundException("Invitación no encontrada.");
      await this.db.client
        .$queryRaw`SELECT id FROM "MembershipInvitation" WHERE id=${invitationId}::uuid AND "tenantId"=${ctx.tenantId}::uuid FOR UPDATE`;
      const current = await this.db.client.membershipInvitation.findFirst({
        where: {
          id: invitationId,
          tenantId: ctx.tenantId,
          membership: { role: "ANALYST", status: "INVITED" },
        },
      });
      if (!current) throw new ConflictException("La invitación ya no está pendiente.");
      if (current.sendLockedAt)
        throw new ConflictException("El correo ya se está enviando. Espera un momento.");
      await this.db.client.membershipInvitation.update({
        where: { id: invitationId },
        data: {
          tokenHash: invitationHash(randomBytes(32).toString("base64url")),
          expiresAt: new Date(
            Date.now() + this.config.getOrThrow<number>("MEMBERSHIP_INVITATION_TTL_HOURS") * 3600000,
          ),
          sentAt: null,
          sendAttempts: 0,
          nextSendAttemptAt: new Date(),
          lastSendErrorCode: null,
          lastSendAttemptAt: null,
        },
      });
      await this.audit.recordTeamInvitation({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        invitationId,
        action: "ANALYST_INVITATION_RESENT",
      });
    });
    const emailSent = await this.delivery.deliver(invitationId);
    return { emailSent, team: await this.list(ctx) };
  }
}
