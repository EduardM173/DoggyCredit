import { jest } from "@jest/globals";
import type { ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { AdminLoginRateGuard, AdminOriginGuard, sessionToken } from "./admin-auth.guards.js";
import { AdminAuthController } from "./admin-auth.controller.js";
import type { AdminAuthService } from "./admin-auth.service.js";
import { hashPassword, verifyPassword } from "./password-hashing.js";

const context = (request: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as ExecutionContext;
describe("administrative auth protections", () => {
  afterEach(() => jest.restoreAllMocks());
  it("limits ten attempts per socket IP, ignores forwarded headers, expires window", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1000);
    const guard = new AdminLoginRateGuard();
    const req = { socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": "1.2.3.4" } };
    for (let i = 0; i < 10; i++) expect(guard.canActivate(context(req))).toBe(true);
    req.headers["x-forwarded-for"] = "5.6.7.8";
    expect(() => guard.canActivate(context(req))).toThrow("Demasiados intentos");
    now.mockReturnValue(901001);
    expect(guard.canActivate(context(req))).toBe(true);
  });
  it("requires exact origin and non-simple header", () => {
    const guard = new AdminOriginGuard(new ConfigService({ WEB_ORIGIN: "https://app.example.test" }));
    expect(
      guard.canActivate(
        context({ headers: { origin: "https://app.example.test", "x-doggycredit-admin": "1" } }),
      ),
    ).toBe(true);
    for (const origin of [undefined, "null", "https://app.example.test.evil.test", "http://app.example.test"])
      expect(() => guard.canActivate(context({ headers: { origin, "x-doggycredit-admin": "1" } }))).toThrow();
  });
  it("hashes passwords with Argon2id and rejects malformed hashes", async () => {
    const hashed = await hashPassword("test-only-password");
    expect(hashed).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hashed, "test-only-password")).toBe(true);
    expect(await verifyPassword(hashed, "wrong")).toBe(false);
    expect(await verifyPassword("invalid", "wrong")).toBe(false);
  });
  it("uses Secure cookies in production and never returns session tokens in JSON", async () => {
    const view = { user: { id: "test" }, expiresAt: "2027-01-01T00:00:00Z" };
    const auth = { login: async () => ({ token: "secret-test-token", view }) } as unknown as AdminAuthService;
    const controller = new AdminAuthController(auth, new ConfigService({ NODE_ENV: "production" }));
    const cookie = jest.fn();
    const result = await controller.login(
      { email: "test@example.test", password: "test" },
      { headers: {} } as Request,
      { cookie } as unknown as Response,
    );
    expect(cookie).toHaveBeenCalledWith(
      "doggycredit_admin",
      "secret-test-token",
      expect.objectContaining({ secure: true, httpOnly: true, sameSite: "strict", path: "/api/admin" }),
    );
    expect(result).toEqual(view);
    expect(sessionToken({ headers: {} } as Request)).toBeUndefined();
  });
});
