import { createHash } from "node:crypto";
import {
  ForbiddenException,
  HttpException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { parse } from "cookie";
import type { Request } from "express";
import { InstitutionAuthService } from "./institution-auth.service.js";

export const institutionCookie = (production: boolean) =>
  production ? "__Host-dc-institution-session" : "dc-institution-session";

export type InstitutionRequest = Request & {
  institutionSession: Awaited<ReturnType<InstitutionAuthService["authenticate"]>>;
};

export const institutionToken = (request: Request, production: boolean) =>
  parse(request.headers.cookie ?? "")[institutionCookie(production)];

@Injectable()
export class InstitutionSessionGuard implements CanActivate {
  constructor(
    private readonly auth: InstitutionAuthService,
    private readonly config: ConfigService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<InstitutionRequest>();
    request.institutionSession = await this.auth.authenticate(
      institutionToken(request, this.config.get("NODE_ENV") === "production"),
    );
    return true;
  }
}

@Injectable()
export class InstitutionOriginGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    if (
      request.headers.origin !== new URL(this.config.getOrThrow<string>("WEB_ORIGIN")).origin ||
      request.headers["x-doggycredit-institution"] !== "1"
    )
      throw new ForbiddenException("Origen de la petición no permitido.");
    return true;
  }
}

@Injectable()
export class InstitutionLoginRateGuard implements CanActivate {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const now = Date.now();
    for (const [key, item] of this.attempts) if (item.resetAt <= now) this.attempts.delete(key);
    const ip = request.socket.remoteAddress ?? "unknown";
    const email = typeof request.body?.email === "string" ? request.body.email.trim().toLowerCase() : "";
    const keys = [`ip:${ip}`, `pair:${createHash("sha256").update(`${ip}:${email}`).digest("hex")}`];
    if (this.attempts.size >= 10000 && keys.some((key) => !this.attempts.has(key)))
      throw new HttpException("Inténtalo más tarde.", 429);
    for (const [index, key] of keys.entries()) {
      const item = this.attempts.get(key) ?? { count: 0, resetAt: now + 15 * 60000 };
      this.attempts.set(key, item);
      if (++item.count > (index === 0 ? 30 : 10)) throw new HttpException("Inténtalo más tarde.", 429);
    }
    return true;
  }
}
