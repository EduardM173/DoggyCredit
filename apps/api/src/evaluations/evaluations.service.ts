import { ConflictException, Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";
import { ApplicantRecords } from "../clients/public.js";
import { TenantPreparationService, type TenantContext } from "../identity-tenants/public.js";
import { AuditWriter } from "../audit/public.js";
import { Prisma } from "../generated/prisma/client.js";
import type { DocumentDto, PrepareEvaluationDto } from "./evaluation.dto.js";
@Injectable()
export class EvaluationsService {
  constructor(
    private readonly db: DatabaseUnitOfWork,
    private readonly clients: ApplicantRecords,
    private readonly preparation: TenantPreparationService,
    private readonly audit: AuditWriter,
  ) {}
  async entry(ctx: TenantContext) {
    await this.preparation.requireAnalyst(ctx);
    return { ready: (await this.preparation.read(ctx)).ready };
  }
  private async ready(ctx: TenantContext) {
    if (!(await this.entry(ctx)).ready)
      throw new ConflictException(
        "La institución todavía no está lista para evaluar. Contacta a su administrador.",
      );
  }
  async lookup(ctx: TenantContext, document: DocumentDto) {
    await this.ready(ctx);
    const applicant = await this.clients.find(ctx.tenantId, document.documentType, document.documentNumber);
    return {
      found: Boolean(applicant),
      applicant: applicant
        ? {
            id: applicant.id,
            name: applicant.name,
            documentType: applicant.documentType,
            documentNumber: applicant.documentNumber,
          }
        : null,
    };
  }
  async prepare(ctx: TenantContext, input: PrepareEvaluationDto) {
    if (input.consent !== true)
      throw new BadRequestException("Debes confirmar el consentimiento antes de iniciar.");
    if (Boolean(input.clientId) === Boolean(input.person))
      throw new BadRequestException("Confirma un expediente o completa los datos mínimos.");
    const amount = new Prisma.Decimal(input.requestedAmount);
    if (amount.lte(0)) throw new BadRequestException("Ingresa un monto mayor a Bs 0.");
    const { idempotencyKey, ...intent } = input;
    const fingerprint = createHash("sha256")
      .update(JSON.stringify({ ...intent, requestedAmount: amount.toFixed(2) }))
      .digest("hex");
    return this.db.run(async () => {
      // Serialize retries of this intent and preparation changes for this tenant.
      await this.db.client.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))`;
      await this.db.client.$queryRaw`SELECT id FROM "Tenant" WHERE id=${ctx.tenantId}::uuid FOR UPDATE`;
      await this.preparation.requireAnalyst(ctx);
      const previous = await this.db.client.evaluation.findUnique({ where: { idempotencyKey } });
      if (previous) {
        if (
          previous.tenantId !== ctx.tenantId ||
          previous.createdByMembershipId !== ctx.membershipId ||
          previous.requestFingerprint !== fingerprint
        )
          throw new ConflictException("Este envío ya fue utilizado para otra solicitud.");
        return this.detail(ctx, previous.id);
      }
      await this.ready(ctx);
      const applicant = await this.clients.resolve(
        ctx.tenantId,
        input.documentType,
        input.documentNumber,
        input.clientId,
        input.person,
      );
      const row = await this.db.client.evaluation.create({
        data: {
          tenantId: ctx.tenantId,
          clientId: applicant.id,
          createdByMembershipId: ctx.membershipId,
          idempotencyKey,
          requestFingerprint: fingerprint,
          purpose: input.purpose,
          requestedAmount: amount,
          status: "DRAFT",
          consentGivenAt: new Date(),
          applicantSnapshot: { ...applicant },
        },
      });
      await this.audit.recordEvaluationPrepared({
        tenantId: ctx.tenantId,
        actorUserId: ctx.userId,
        evaluationId: row.id,
      });
      return this.detail(ctx, row.id);
    });
  }
  async detail(ctx: TenantContext, id: string) {
    await this.preparation.requireAnalyst(ctx);
    const row = await this.db.client.evaluation.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: {
        id: true,
        status: true,
        purpose: true,
        requestedAmount: true,
        applicantSnapshot: true,
        consentGivenAt: true,
        createdAt: true,
      },
    });
    if (!row) throw new NotFoundException("Evaluación no encontrada.");
    return { ...row, requestedAmount: row.requestedAmount.toFixed(2) };
  }
}
