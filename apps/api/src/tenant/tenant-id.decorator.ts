import { BadRequestException, createParamDecorator, ExecutionContext } from "@nestjs/common";
import { isUUID } from "class-validator";
import type { Request } from "express";

export const TenantId = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<Request>();
  const tenantId = request.header("x-tenant-id");

  if (!tenantId || !isUUID(tenantId)) {
    throw new BadRequestException("A valid x-tenant-id UUID header is required.");
  }

  return tenantId;
});
