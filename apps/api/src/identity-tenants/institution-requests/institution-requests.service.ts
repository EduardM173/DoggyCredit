import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import type { InstitutionRequestReceipt, SubmitInstitutionRequest } from "./institution-request.contract.js";
import { EmailVerificationService } from "../email-verification/email-verification.service.js";
import { PublicPlansService } from "../../plans-metering/public.js";

@Injectable()
export class InstitutionRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verification: EmailVerificationService,
    private readonly plans: PublicPlansService,
  ) {}

  async create(input: SubmitInstitutionRequest): Promise<InstitutionRequestReceipt> {
    if (input.planInterest !== "UNSURE") {
      if (!(await this.plans.isSelectable(input.planInterest)))
        throw new BadRequestException("Selecciona un plan de interés vigente.");
    }
    const receipt = await this.prisma.$transaction(async (tx) => {
      // Transaction-scoped locks make the check + insert atomic without permanent unique constraints.
      for (const key of [
        `institution-request:email:${input.contactEmail}`,
        `institution-request:nit:${input.taxId}`,
      ].sort()) {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      }

      const duplicate = await tx.institutionRequest.findFirst({
        where: { OR: [{ taxId: input.taxId }, { contactEmail: input.contactEmail }] },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException(
          "Ya existe una solicitud con ese NIT o correo. Revisa los datos antes de volver a enviarla.",
        );
      }

      const request = await tx.institutionRequest.create({
        data: {
          institutionName: input.institutionName,
          taxId: input.taxId,
          institutionType: input.institutionType,
          contactName: input.contactName,
          contactRole: input.contactRole,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          planInterest: input.planInterest,
          status: "EMAIL_PENDING",
        },
        select: { id: true, contactEmail: true, status: true },
      });
      return { id: request.id, contactEmail: request.contactEmail, status: "EMAIL_PENDING" as const };
    });
    // Creation is already committed. A delivery failure must not look like a lost request.
    let delivery: Pick<InstitutionRequestReceipt, "emailDelivery" | "retryAfterSeconds"> = {
      emailDelivery: "FAILED",
      retryAfterSeconds: 0,
    };
    try {
      delivery = await this.verification.send(receipt.id);
    } catch {
      /* Retry through resend without recreating the request. */
    }
    return { ...receipt, ...delivery };
  }
}
