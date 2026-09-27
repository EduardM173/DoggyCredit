import { createHash, randomBytes } from "node:crypto";
import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { RequestContextReader } from "../identity-tenants/public.js";
import { AuditWriter } from "../audit/public.js";
const digest = (token: string) => createHash("sha256").update(token).digest("hex");
@Injectable()
export class ContractingAccessService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly requests: RequestContextReader,
    private readonly config: ConfigService,
    private readonly audit: AuditWriter,
  ) {}
  async issue(requestId: string, actorUserId: string) {
    return this.db.run(async () => {
      await this.db.client
        .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contract-access:${requestId}`},0))`;
      await this.requests.approved(requestId);
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(
        Date.now() + this.config.getOrThrow<number>("CONTRACTING_ACCESS_TOKEN_TTL_MINUTES") * 60000,
      );
      await this.db.client.contractingCredential.updateMany({
        where: { requestId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.db.client.contractingCredential.create({
        data: { requestId, kind: "ACCESS", tokenHash: digest(token), expiresAt },
      });
      await this.audit.recordCommerce({
        action: "CONTRACTING_ACCESS_ISSUED",
        entityType: "InstitutionRequest",
        entityId: requestId,
        actorUserId,
        actorKind: "OPERATOR",
      });
      const url = new URL("/contratacion", this.config.getOrThrow<string>("PUBLIC_APP_URL"));
      url.hash = `token=${token}`;
      return { url: url.toString(), expiresAt: expiresAt.toISOString() };
    });
  }
  async exchange(token: string) {
    return this.db.run(async () => {
      const access = await this.db.client.contractingCredential.findUnique({
        where: { tokenHash: digest(token) },
      });
      if (!access) throw new UnauthorizedException("El enlace no está disponible o venció.");
      await this.db.client
        .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contract-access:${access.requestId}`},0))`;
      await this.requests.approved(access.requestId);
      const consumed = await this.db.client.contractingCredential.updateMany({
        where: {
          id: access.id,
          kind: "ACCESS",
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1)
        throw new UnauthorizedException("El enlace ya se utilizó, fue reemplazado o venció.");
      const session = randomBytes(32).toString("base64url");
      const expiresAt = new Date(
        Date.now() + this.config.getOrThrow<number>("CONTRACTING_SESSION_TTL_MINUTES") * 60000,
      );
      await this.db.client.contractingCredential.create({
        data: { requestId: access.requestId, kind: "SESSION", tokenHash: digest(session), expiresAt },
      });
      return { token: session, expiresAt };
    });
  }
  async authenticate(token?: string) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new UnauthorizedException("Abre un enlace de contratación válido.");
    const session = await this.db.client.contractingCredential.findUnique({
      where: { tokenHash: digest(token) },
    });
    if (!session || session.kind !== "SESSION" || session.revokedAt || session.expiresAt <= new Date())
      throw new UnauthorizedException("La sesión de contratación venció. Solicita un nuevo enlace.");
    await this.requests.approved(session.requestId);
    return session.requestId;
  }
  async lockApproved(requestId: string) {
    await this.db.client
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contracting:${requestId}`},0))`;
    const context = await this.requests.approved(requestId);
    if (context.status !== "APPROVED") throw new ConflictException();
    return context;
  }
}
