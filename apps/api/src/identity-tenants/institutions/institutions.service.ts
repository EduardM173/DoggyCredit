import { Injectable } from "@nestjs/common";
import { DatabaseUnitOfWork } from "../../infrastructure/prisma/database-unit-of-work.js";
import type { Prisma } from "../../generated/prisma/client.js";
@Injectable()
export class InstitutionsService {
  constructor(private readonly db: DatabaseUnitOfWork) {}
  async list(query: {
    search?: string;
    activationStatus?: "INVITED" | "ACTIVE";
    page: number;
    pageSize: number;
  }) {
    const search = query.search?.trim();
    const taxSearch = search?.replace(/[\s.-]/g, "");
    const where: Prisma.TenantWhereInput = {
      createdFromRequestId: { not: null },
      memberships: {
        some: {
          isInitialAdmin: true,
          role: "INSTITUTION_ADMIN",
          ...(query.activationStatus ? { status: query.activationStatus } : {}),
        },
      },
      ...(search
        ? {
            OR: [
              { legalName: { contains: search, mode: "insensitive" } },
              { taxId: { contains: taxSearch || search, mode: "insensitive" } },
              {
                memberships: {
                  some: {
                    isInitialAdmin: true,
                    role: "INSTITUTION_ADMIN",
                    user: {
                      OR: [
                        { fullName: { contains: search, mode: "insensitive" } },
                        { email: { contains: search, mode: "insensitive" } },
                      ],
                    },
                  },
                },
              },
            ],
          }
        : {}),
    };
    return this.db.run(async () => {
      const total = await this.db.client.tenant.count({ where });
      const rows = await this.db.client.tenant.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ createdFromRequest: { reviewedAt: { sort: "desc", nulls: "last" } } }, { id: "desc" }],
        select: {
          id: true,
          legalName: true,
          taxId: true,
          createdFromRequest: { select: { reviewedAt: true } },
          memberships: {
            where: { isInitialAdmin: true, role: "INSTITUTION_ADMIN" },
            select: { status: true, user: { select: { fullName: true, email: true } } },
            take: 1,
          },
        },
      });
      return {
        items: rows.map((row) => ({
          tenantId: row.id,
          institutionName: row.legalName,
          nit: row.taxId,
          initialAdmin: { name: row.memberships[0].user.fullName, email: row.memberships[0].user.email },
          activationStatus: row.memberships[0].status,
          approvedAt: row.createdFromRequest?.reviewedAt?.toISOString() ?? null,
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }
}
