import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import type { InstitutionRequest } from "./institution-auth.guards.js";

export type TenantContext = {
  userId: string;
  tenantId: string;
  tenantSlug: string;
  membershipId: string;
  role: "INSTITUTION_ADMIN" | "ANALYST";
  userName: string;
  tenantName: string;
  taxId: string;
  institutionType: string;
};
export type TenantRequest = InstitutionRequest & { tenantContext: TenantContext };

@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<TenantRequest>();
    const slug = request.params.tenantSlug;
    if (typeof slug !== "string" || slug.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      throw new NotFoundException("Institución no encontrada.");
    const tenant = await this.prisma.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, legalName: true, taxId: true, institutionType: true, status: true },
    });
    if (!tenant) throw new NotFoundException("Institución no encontrada.");
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId: tenant.id, userId: request.institutionSession.user.id } },
      select: { id: true, role: true, status: true },
    });
    if (tenant.status !== "ACTIVE" || membership?.status !== "ACTIVE")
      throw new ForbiddenException("No tienes acceso a este espacio institucional.");
    request.tenantContext = {
      userId: request.institutionSession.user.id,
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      membershipId: membership.id,
      role: membership.role,
      userName: request.institutionSession.user.fullName,
      tenantName: tenant.legalName,
      taxId: tenant.taxId,
      institutionType: tenant.institutionType,
    };
    return true;
  }
}
