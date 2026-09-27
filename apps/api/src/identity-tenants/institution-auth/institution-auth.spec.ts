import { jest } from "@jest/globals";
import type { ExecutionContext } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { InstitutionAuthController } from "./institution-auth.controller.js";
import {
  InstitutionLoginRateGuard,
  InstitutionOriginGuard,
  institutionCookie,
} from "./institution-auth.guards.js";
import type { InstitutionAuthService } from "./institution-auth.service.js";

const context = (request: unknown) =>
  ({ switchToHttp: () => ({ getRequest: () => request }) }) as ExecutionContext;

describe("institutional auth protections", () => {
  afterEach(() => jest.restoreAllMocks());
  it("uses a host-only Secure cookie in production, distinct from admin", async () => {
    const auth = {
      login: async () => ({
        token: "opaque-secret",
        expiresAt: new Date("2027-01-01"),
        view: { activeMemberships: [{ tenant: { name: "X", slug: "x" } }] },
      }),
    } as unknown as InstitutionAuthService;
    const controller = new InstitutionAuthController(auth, new ConfigService({ NODE_ENV: "production" }));
    const cookie = jest.fn();
    const result = await controller.login(
      { email: "test@example.test", password: "test" },
      { headers: {} } as Request,
      { cookie } as unknown as Response,
    );
    expect(institutionCookie(true)).toBe("__Host-dc-institution-session");
    expect(cookie).toHaveBeenCalledWith(
      "__Host-dc-institution-session",
      "opaque-secret",
      expect.objectContaining({ secure: true, httpOnly: true, sameSite: "strict", path: "/" }),
    );
    expect(JSON.stringify(result)).not.toContain("opaque-secret");
  });
  it("requires expected Origin and custom header", () => {
    const guard = new InstitutionOriginGuard(new ConfigService({ WEB_ORIGIN: "https://app.example.test" }));
    expect(
      guard.canActivate(
        context({ headers: { origin: "https://app.example.test", "x-doggycredit-institution": "1" } }),
      ),
    ).toBe(true);
    for (const origin of [undefined, "null", "https://app.example.test.evil.test"])
      expect(() =>
        guard.canActivate(context({ headers: { origin, "x-doggycredit-institution": "1" } })),
      ).toThrow();
  });
  it("limits per socket IP and never stores a plain email in rate-limit keys", () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1000);
    const guard = new InstitutionLoginRateGuard();
    const req = { socket: { remoteAddress: "127.0.0.1" }, body: { email: "Test@Example.test" } };
    for (let i = 0; i < 10; i++) expect(guard.canActivate(context(req))).toBe(true);
    expect(() => guard.canActivate(context(req))).toThrow();
    expect(JSON.stringify(guard)).not.toContain("Test@Example.test");
    now.mockReturnValue(901001);
    expect(guard.canActivate(context(req))).toBe(true);
  });
});
