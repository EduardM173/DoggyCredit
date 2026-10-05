import { BadRequestException, Injectable } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import { AuditWriter } from "../../audit/public.js";
import { hashPassword } from "../auth/password-hashing.js";
import { invitationHash } from "../provisioning/provision-institution.service.js";
import { activationPassword } from "./activation-password.js";

type Invitation = NonNullable<Awaited<ReturnType<ActivationService["find"]>>>;

@Injectable()
export class ActivationService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly audit: AuditWriter,
  ) {}

  async find(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new BadRequestException("El enlace de activación no es válido.");
    return this.db.client.membershipInvitation.findUnique({
      where: { tokenHash: invitationHash(token) },
      include: {
        membership: {
          include: {
            user: { select: { id: true, fullName: true, email: true, passwordHash: true, status: true } },
            tenant: { select: { id: true, legalName: true, slug: true, status: true } },
          },
        },
      },
    });
  }

  private valid(row: Invitation | null) {
    if (!row) throw new BadRequestException("El enlace de activación no es válido.");
    if (row.acceptedAt) throw new BadRequestException("El enlace ya fue utilizado.");
    if (row.expiresAt <= new Date()) throw new BadRequestException("El enlace de activación venció.");
    if (
      row.invalidatedAt ||
      !row.sentAt ||
      row.sendLockedAt ||
      row.tenantId !== row.membership.tenantId ||
      row.membership.status !== "INVITED" ||
      row.membership.role !== "INSTITUTION_ADMIN" ||
      !row.membership.isInitialAdmin ||
      row.membership.tenant.status !== "ACTIVE" ||
      row.membership.user.status === "BLOCKED"
    )
      throw new BadRequestException("El enlace de activación no está disponible.");
    return row;
  }

  async preview(token: string) {
    const row = this.valid(await this.find(token));
    return {
      valid: true,
      institution: { name: row.membership.tenant.legalName },
      invitedUser: { name: row.membership.user.fullName, email: row.membership.user.email },
      role: "INSTITUTION_ADMIN",
      requiresCredentialSetup: !row.membership.user.passwordHash,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  async activate(token: string, password?: string) {
    const initial = this.valid(await this.find(token));
    const needsPassword = !initial.membership.user.passwordHash;
    if (needsPassword && typeof password !== "string")
      throw new BadRequestException("Debes definir una contraseña.");
    if (!needsPassword && password !== undefined)
      throw new BadRequestException("Esta cuenta ya tiene credenciales. No se cambiarán aquí.");
    const encoded = needsPassword ? await hashPassword(activationPassword(password!)) : null;
    return this.db.run(async () => {
      const row = this.valid(await this.find(token));
      const now = new Date();
      const consumed = await this.db.client.membershipInvitation.updateMany({
        where: {
          id: row.id,
          acceptedAt: null,
          invalidatedAt: null,
          sentAt: { not: null },
          sendLockedAt: null,
          expiresAt: { gt: now },
          tokenHash: invitationHash(token),
        },
        data: { acceptedAt: now },
      });
      if (consumed.count !== 1) throw new BadRequestException("El enlace ya no está disponible.");
      if (needsPassword) {
        const updated = await this.db.client.user.updateMany({
          where: { id: row.membership.user.id, passwordHash: null, status: { in: ["INVITED", "ACTIVE"] } },
          data: { passwordHash: encoded!, status: "ACTIVE", emailVerifiedAt: now },
        });
        if (updated.count !== 1) throw new BadRequestException("La identidad cambió. Actualiza la página.");
      } else if (row.membership.user.status === "INVITED") {
        const updated = await this.db.client.user.updateMany({
          where: { id: row.membership.user.id, status: "INVITED", passwordHash: { not: null } },
          data: { status: "ACTIVE", emailVerifiedAt: now },
        });
        if (updated.count !== 1) throw new BadRequestException("La identidad cambió. Actualiza la página.");
      } else {
        const active = await this.db.client.user.updateMany({
          where: { id: row.membership.user.id, status: "ACTIVE", passwordHash: { not: null } },
          data: { status: "ACTIVE" },
        });
        if (active.count !== 1) throw new BadRequestException("La identidad cambió. Actualiza la página.");
      }
      const membership = await this.db.client.tenantMembership.updateMany({
        where: { id: row.membershipId, tenantId: row.tenantId, status: "INVITED", role: "INSTITUTION_ADMIN" },
        data: { status: "ACTIVE" },
      });
      if (membership.count !== 1) throw new BadRequestException("El acceso ya no está disponible.");
      await this.audit.recordMembershipActivation({
        userId: row.membership.user.id,
        tenantId: row.tenantId,
        membershipId: row.membershipId,
        invitationId: row.id,
      });
      return {
        activated: true,
        institution: { name: row.membership.tenant.legalName, slug: row.membership.tenant.slug },
        membershipStatus: "ACTIVE",
      };
    });
  }
}
