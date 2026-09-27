import { createHash, randomBytes } from "node:crypto";
import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { hashPassword, verifyPassword } from "./password-hashing.js";
import type { AdminSessionView } from "./admin-auth.contract.js";

const digest = (token: string) => createHash("sha256").update(token).digest("hex");
const identitySelect = { id: true, fullName: true, email: true, platformRole: true } as const;

@Injectable()
export class AdminAuthService {
  private readonly dummy = hashPassword(randomBytes(32).toString("hex"));
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async login(email: string, password: string, previousToken?: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { ...identitySelect, status: true, passwordHash: true },
    });
    const valid = await verifyPassword(user?.passwordHash ?? (await this.dummy), password);
    if (!valid || !user || user.status !== "ACTIVE" || user.platformRole !== "OPERATOR")
      throw new UnauthorizedException("Credenciales incorrectas.");
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + this.config.getOrThrow<number>("ADMIN_SESSION_TTL_MINUTES") * 60000,
    );
    await this.prisma.$transaction(async (tx) => {
      if (previousToken)
        await tx.adminSession.updateMany({
          where: { tokenHash: digest(previousToken), revokedAt: null },
          data: { revokedAt: new Date() },
        });
      await tx.adminSession.create({ data: { userId: user.id, tokenHash: digest(token), expiresAt } });
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    });
    const { id, fullName, platformRole } = user;
    return {
      token,
      view: {
        user: { id, fullName, email: user.email, platformRole },
        expiresAt: expiresAt.toISOString(),
      } satisfies AdminSessionView,
    };
  }

  async authenticate(token?: string): Promise<AdminSessionView> {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException("Inicia sesión para continuar.");
    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash: digest(token) },
      select: {
        expiresAt: true,
        revokedAt: true,
        user: { select: { ...identitySelect, status: true } },
      },
    });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== "ACTIVE")
      throw new UnauthorizedException("La sesión no está disponible. Inicia sesión nuevamente.");
    const { id, fullName, email, platformRole } = session.user;
    return { user: { id, fullName, email, platformRole }, expiresAt: session.expiresAt.toISOString() };
  }

  async logout(token?: string) {
    if (token)
      await this.prisma.adminSession.updateMany({
        where: { tokenHash: digest(token), revokedAt: null },
        data: { revokedAt: new Date() },
      });
  }
}
