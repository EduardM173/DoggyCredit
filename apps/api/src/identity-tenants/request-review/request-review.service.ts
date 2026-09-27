import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { Prisma } from "../../generated/prisma/client.js";
import { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import { AuditWriter } from "../../audit/public.js";
import type { RequestSearch, ReviewDetail, ReviewList } from "./request-review.contract.js";

const itemSelect = {
  id: true,
  institutionName: true,
  taxId: true,
  contactEmail: true,
  status: true,
  createdAt: true,
  planInterest: true,
} as const;

@Injectable()
export class RequestReviewService {
  constructor(
    private readonly database: DatabaseUnitOfWork,
    private readonly audit: AuditWriter,
  ) {}
  async list(query: RequestSearch): Promise<ReviewList> {
    const term = query.search;
    const date = query.date ? new Date(`${query.date}T00:00:00.000Z`) : undefined;
    const nit = term?.replace(/[\s.-]/g, "");
    const where: Prisma.InstitutionRequestWhereInput = {
      status: query.status,
      ...(date ? { createdAt: { gte: date, lt: new Date(date.getTime() + 86400000) } } : {}),
      ...(term
        ? {
            OR: [
              { institutionName: { contains: term, mode: "insensitive" } },
              { contactEmail: { contains: term, mode: "insensitive" } },
              ...(nit ? [{ taxId: { contains: nit } }] : []),
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.database.client.institutionRequest.findMany({
        where,
        select: itemSelect,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.database.client.institutionRequest.count({ where }),
    ]);
    return {
      items: items.map((item) => ({ ...item, createdAt: item.createdAt.toISOString() })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }
  async detail(id: string): Promise<ReviewDetail> {
    const row = await this.database.client.institutionRequest.findUnique({
      where: { id },
      select: {
        ...itemSelect,
        institutionType: true,
        contactName: true,
        contactRole: true,
        contactPhone: true,
        emailVerifiedAt: true,
        reviewedAt: true,
        rejectionReason: true,
        reviewedBy: { select: { fullName: true } },
      },
    });
    if (!row) throw new NotFoundException("No encontramos la solicitud.");
    const { reviewedBy, ...details } = row;
    return {
      ...details,
      createdAt: row.createdAt.toISOString(),
      emailVerifiedAt: row.emailVerifiedAt?.toISOString() ?? null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewer: reviewedBy,
    };
  }
  async decide(
    id: string,
    actorUserId: string,
    decision: "APPROVED" | "REJECTED",
    reason?: string,
  ): Promise<ReviewDetail> {
    return this.database.run(async () => {
      const changed = await this.database.client.institutionRequest.updateMany({
        where: { id, status: "PENDING_REVIEW", emailVerifiedAt: { not: null } },
        data: {
          status: decision,
          reviewedAt: new Date(),
          reviewedById: actorUserId,
          rejectionReason: decision === "REJECTED" ? reason || null : null,
        },
      });
      if (changed.count !== 1)
        throw new ConflictException(
          "La solicitud ya fue resuelta o todavía no tiene el correo verificado. Actualiza el detalle.",
        );
      await this.audit.recordRequestDecision({ actorUserId, requestId: id, decision });
      return this.detail(id);
    });
  }
}
