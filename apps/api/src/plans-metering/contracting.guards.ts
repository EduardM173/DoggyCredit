import { Injectable, HttpException, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { parse } from "cookie";
import type { Request } from "express";
import { ContractingAccessService } from "./contracting-access.service.js";
export const CONTRACTING_COOKIE = "doggycredit_contracting";
export type ContractingRequest = Request & { institutionRequestId: string };
@Injectable()
export class ContractingGuard implements CanActivate {
  constructor(private readonly access: ContractingAccessService) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<ContractingRequest>();
    req.institutionRequestId = await this.access.authenticate(
      parse(req.headers.cookie ?? "")[CONTRACTING_COOKIE],
    );
    return true;
  }
}
@Injectable()
export class PaymentPublicRateGuard implements CanActivate {
  private readonly attempts = new Map<string, { count: number; until: number }>();
  canActivate(context: ExecutionContext) {
    const now = Date.now();
    for (const [key, value] of this.attempts) if (value.until <= now) this.attempts.delete(key);
    const ip = context.switchToHttp().getRequest<Request>().socket.remoteAddress ?? "unknown";
    if (!this.attempts.has(ip) && this.attempts.size >= 10000)
      throw new HttpException({ message: "Inténtalo más tarde.", retryAfterSeconds: 60 }, 429);
    const entry = this.attempts.get(ip) ?? { count: 0, until: now + 60000 };
    this.attempts.set(ip, entry);
    if (++entry.count > 120)
      throw new HttpException(
        { message: "Demasiados intentos.", retryAfterSeconds: Math.ceil((entry.until - now) / 1000) },
        429,
      );
    return true;
  }
}
