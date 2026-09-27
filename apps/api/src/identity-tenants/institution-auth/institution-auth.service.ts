import { createHash, randomBytes } from "node:crypto";
import { Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { hashPassword, verifyPassword } from "../auth/password-hashing.js";

const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const unauthorized = () => new UnauthorizedException("Credenciales incorrectas.");

@Injectable()
export class InstitutionAuthService {
  private readonly logger = new Logger(InstitutionAuthService.name);
  private readonly dummy = hashPassword(randomBytes(32).toString("hex"));
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async memberships(userId: string) {
    const rows = await this.prisma.tenantMembership.findMany({
      where: { userId, status: "ACTIVE", tenant: { status: "ACTIVE" } },
      select: {
        role: true,
        tenant: { select: { legalName: true, slug: true } },
      },
      orderBy: { tenant: { legalName: "asc" } },
    });
    return rows.map(({ role, tenant }) => ({
      tenant: { name: tenant.legalName, slug: tenant.slug },
      role,
    }));
  }

  async login(email: string, password: string, previousToken?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, fullName: true, email: true, status: true, passwordHash: true },
    });
    const valid = await verifyPassword(user?.passwordHash ?? (await this.dummy), password.normalize("NFC"));
    if (!valid || !user || user.status !== "ACTIVE") {
      this.logger.warn("Institution login rejected");
      throw unauthorized();
    }
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + this.config.getOrThrow<number>("INSTITUTION_SESSION_ABSOLUTE_MINUTES") * 60000,
    );
    const token = randomBytes(32).toString("base64url");
    await this.prisma.$transaction(async (tx) => {
      if (previousToken)
        await tx.institutionSession.updateMany({
          where: { tokenHash: digest(previousToken), userId: user.id, revokedAt: null },
          data: { revokedAt: now },
        });
      await tx.institutionSession.create({
        data: { userId: user.id, tokenHash: digest(token), lastSeenAt: now, expiresAt },
      });
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
    });
    this.logger.log(`Institution login success userId=${user.id}`);
    return { token, view: await this.me(user.id), expiresAt };
  }

  async authenticate(token?: string) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException("Inicia sesión para continuar.");
    const now = new Date();
    const idleCutoff = new Date(
      now.getTime() - this.config.getOrThrow<number>("INSTITUTION_SESSION_IDLE_MINUTES") * 60000,
    );
    const session = await this.prisma.institutionSession.findUnique({
      where: { tokenHash: digest(token) },
      select: {
        id: true,
        lastSeenAt: true,
        expiresAt: true,
        revokedAt: true,
        user: { select: { id: true, fullName: true, email: true, status: true } },
      },
    });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.lastSeenAt <= idleCutoff ||
      session.user.status !== "ACTIVE"
    )
      throw new UnauthorizedException("La sesión terminó. Inicia sesión nuevamente.");
    const touched = await this.prisma.institutionSession.updateMany({
      where: {
        id: session.id,
        revokedAt: null,
        expiresAt: { gt: now },
        lastSeenAt: { gt: idleCutoff },
        user: { status: "ACTIVE" },
      },
      data: { lastSeenAt: now },
    });
    if (touched.count !== 1) throw new UnauthorizedException("La sesión terminó. Inicia sesión nuevamente.");
    const { id, fullName, email } = session.user;
    return { user: { id, fullName, email }, expiresAt: session.expiresAt.toISOString() };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, fullName: true, email: true },
    });
    const activeMemberships = await this.memberships(userId);
    return { user, activeMemberships };
  }

  async logout(token?: string) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    const result = await this.prisma.institutionSession.updateMany({
      where: { tokenHash: digest(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count) this.logger.log("Institution session revoked");
  }
}
