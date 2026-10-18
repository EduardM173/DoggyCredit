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

  async list(ctx: TenantContext, page = 1) {
    this.admin(ctx);
    const where = { tenantId: ctx.tenantId };
    const [rows, total, grouped] = await Promise.all([
      this.db.client.tenantMembership.findMany({
        where,
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
        orderBy: [{ isInitialAdmin: "desc" }, { createdAt: "asc" }, { id: "asc" }],
        skip: (page - 1) * 20,
        take: 20,
      }),
      this.db.client.tenantMembership.count({ where }),
      this.db.client.tenantMembership.groupBy({
        by: ["status"],
        where,
        _count: { _all: true },
      }),
    ]);
    return {
      tenant: { name: ctx.tenantName, slug: ctx.tenantSlug },
      actorMembershipId: ctx.membershipId,
      page,
      pageCount: Math.max(1, Math.ceil(total / 20)),
      total,
      counts: Object.fromEntries(grouped.map((row) => [row.status, row._count._all])),
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
    await this.db.client.$queryRaw`SELECT id FROM "Tenant" WHERE id=${ctx.tenantId}::uuid FOR UPDATE`;
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

  async invite(ctx: TenantContext, email: string, role: "ANALYST" | "INSTITUTION_ADMIN" = "ANALYST") {
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
        data: { tenantId: ctx.tenantId, userId: user.id, role, status: "INVITED" },
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
        action: role === "ANALYST" ? "ANALYST_INVITATION_CREATED" : "ADMIN_INVITATION_CREATED",
      });
      return invitation.id;
    });
    const delivery = await this.delivery.deliver(invitationId);
    return {
      emailSent: delivery.delivered,
      emailDelivery: delivery.delivered
        ? delivery.channel === "TEST_INBOX"
          ? "TEST_INBOX"
          : "SENT"
        : "FAILED",
      team: await this.list(ctx),
    };
  }

  async resend(ctx: TenantContext, invitationId: string) {
    this.admin(ctx);
    await this.db.run(async () => {
      await this.lockActor(ctx);
      const invitation = await this.db.client.membershipInvitation.findFirst({
        where: { id: invitationId, tenantId: ctx.tenantId },
        select: { membershipId: true },
      });
      if (!invitation) throw new NotFoundException("Invitación no encontrada.");
      await this.db.client
        .$queryRaw`SELECT id FROM "MembershipInvitation" WHERE id=${invitationId}::uuid AND "tenantId"=${ctx.tenantId}::uuid FOR UPDATE`;
      const current = await this.db.client.membershipInvitation.findFirst({
        where: {
          id: invitationId,
          tenantId: ctx.tenantId,
          membership: { status: "INVITED" },
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
      const membership = await this.db.client.tenantMembership.findUniqueOrThrow({
        where: { id: current.membershipId },
        select: { role: true },
      });
      await this.audit.recordTeamInvitation({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        invitationId,
        action: membership.role === "ANALYST" ? "ANALYST_INVITATION_RESENT" : "ADMIN_INVITATION_RESENT",
      });
    });
    const delivery = await this.delivery.deliver(invitationId);
    return {
      emailSent: delivery.delivered,
      emailDelivery: delivery.delivered
        ? delivery.channel === "TEST_INBOX"
          ? "TEST_INBOX"
          : "SENT"
        : "FAILED",
      team: await this.list(ctx),
    };
  }

  async change(
    ctx: TenantContext,
    membershipId: string,
    action: "cancel" | "suspend" | "reactivate" | "revoke",
  ) {
    this.admin(ctx);
    await this.db.run(async () => {
      await this.lockActor(ctx);
      const target = await this.db.client.tenantMembership.findFirst({
        where: { id: membershipId, tenantId: ctx.tenantId },
        select: { id: true, userId: true, role: true, status: true, isInitialAdmin: true },
      });
      if (!target) throw new NotFoundException("Miembro no encontrado.");
      if (action === "cancel" || action === "revoke") {
        await this.db.client
          .$queryRaw`SELECT id FROM "MembershipInvitation" WHERE "membershipId"=${membershipId}::uuid AND "tenantId"=${ctx.tenantId}::uuid AND "acceptedAt" IS NULL AND "invalidatedAt" IS NULL ORDER BY id FOR UPDATE`;
      }
      await this.db.client
        .$queryRaw`SELECT id FROM "TenantMembership" WHERE id=${membershipId}::uuid FOR UPDATE`;
      const current = await this.db.client.tenantMembership.findUniqueOrThrow({
        where: { id: membershipId },
        select: { status: true },
      });
      const next = action === "reactivate" ? "ACTIVE" : action === "suspend" ? "SUSPENDED" : "REVOKED";
      if (current.status === next) return;
      const allowed =
        action === "cancel"
          ? current.status === "INVITED"
          : action === "suspend"
            ? current.status === "ACTIVE"
            : action === "reactivate"
              ? current.status === "SUSPENDED"
              : current.status === "ACTIVE" || current.status === "SUSPENDED" || current.status === "INVITED";
      if (!allowed) throw new ConflictException("El estado del acceso cambió. Actualiza el equipo.");
      if (target.role === "INSTITUTION_ADMIN") {
        if (action === "suspend" || action === "reactivate")
          throw new ForbiddenException("La suspensión de administradores no está habilitada.");
        if (target.userId === ctx.userId)
          throw new ForbiddenException("No puedes retirar tu propio acceso administrativo.");
        if (current.status === "ACTIVE") {
          const operational = await this.db.client.tenantMembership.count({
            where: {
              tenantId: ctx.tenantId,
              role: "INSTITUTION_ADMIN",
              status: "ACTIVE",
              user: { status: "ACTIVE", passwordHash: { not: null } },
            },
          });
          if (operational < 2)
            throw new ConflictException(
              "Debe permanecer otro administrador activo antes de retirar este acceso.",
            );
        }
      }
      const changed = await this.db.client.tenantMembership.updateMany({
        where: { id: membershipId, tenantId: ctx.tenantId, status: current.status },
        data: { status: next },
      });
      if (changed.count !== 1)
        throw new ConflictException("El estado del acceso cambió. Actualiza el equipo.");
      if (next === "REVOKED") {
        await this.db.client.membershipInvitation.updateMany({
          where: { membershipId, tenantId: ctx.tenantId, acceptedAt: null, invalidatedAt: null },
          data: { invalidatedAt: new Date(), nextSendAttemptAt: null },
        });
      }
      await this.audit.recordTeamAccess({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        membershipId,
        action:
          action === "cancel"
            ? "INVITATION_CANCELLED"
            : action === "suspend"
              ? "MEMBERSHIP_SUSPENDED"
              : action === "reactivate"
                ? "MEMBERSHIP_REACTIVATED"
                : "MEMBERSHIP_REVOKED",
        fromStatus: current.status,
        toStatus: next,
      });
    });
    return this.list(ctx);
  }
}
