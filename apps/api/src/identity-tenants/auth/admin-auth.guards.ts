import {
  Injectable,
  ForbiddenException,
  HttpException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { parse } from "cookie";
import type { Request } from "express";
import { AdminAuthService } from "./admin-auth.service.js";
import type { AdminSessionView } from "./admin-auth.contract.js";

export const ADMIN_COOKIE = "doggycredit_admin";
export type AdminRequest = Request & { adminSession: AdminSessionView };
export const sessionToken = (request: Request) => parse(request.headers.cookie ?? "")[ADMIN_COOKIE];

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(private readonly auth: AdminAuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    request.adminSession = await this.auth.authenticate(sessionToken(request));
    return true;
  }
}

@Injectable()
export class OperatorGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    if (context.switchToHttp().getRequest<AdminRequest>().adminSession?.user.platformRole !== "OPERATOR")
      throw new ForbiddenException("No tienes permiso para revisar solicitudes.");
    return true;
  }
}

@Injectable()
export class AdminOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      request.headers.origin !== new URL(this.config.getOrThrow<string>("WEB_ORIGIN")).origin ||
      request.headers["x-doggycredit-admin"] !== "1"
    )
      throw new ForbiddenException("Origen de la petición no permitido.");
    return true;
  }
}

@Injectable()
export class AdminLoginRateGuard implements CanActivate {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const now = Date.now();
    for (const [key, entry] of this.attempts) if (entry.resetAt <= now) this.attempts.delete(key);
    // Use the socket IP. Never trust a user-controlled X-Forwarded-For header.
    const key = request.socket.remoteAddress ?? "unknown";
    if (!this.attempts.has(key) && this.attempts.size >= 10000)
      throw new HttpException({ message: "Inténtalo más tarde.", retryAfterSeconds: 60 }, 429);
    const entry = this.attempts.get(key) ?? { count: 0, resetAt: now + 15 * 60000 };
    this.attempts.set(key, entry);
    if (++entry.count > 10)
      throw new HttpException(
        {
          message: "Demasiados intentos. Inténtalo más tarde.",
          retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
        },
        429,
      );
    return true;
  }
}
