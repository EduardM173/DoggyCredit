import { CanActivate, ExecutionContext, HttpException, Injectable } from "@nestjs/common";
import type { Request } from "express";

@Injectable()
export class ActivationRateGuard implements CanActivate {
  private readonly attempts = new Map<string, { count: number; resetAt: number }>();
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const now = Date.now();
    for (const [key, item] of this.attempts) if (item.resetAt <= now) this.attempts.delete(key);
    const key = request.socket.remoteAddress ?? "unknown";
    if (!this.attempts.has(key) && this.attempts.size >= 10000)
      throw new HttpException({ message: "Inténtalo más tarde." }, 429);
    const item = this.attempts.get(key) ?? { count: 0, resetAt: now + 15 * 60000 };
    this.attempts.set(key, item);
    if (++item.count > 60) throw new HttpException({ message: "Inténtalo más tarde." }, 429);
    return true;
  }
}
