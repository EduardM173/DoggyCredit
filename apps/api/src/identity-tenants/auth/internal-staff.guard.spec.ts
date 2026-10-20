import { ForbiddenException } from "@nestjs/common";
import { InternalStaffGuard } from "./admin-auth.guards.js";

const ctx = (platformRole?: string) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ adminSession: platformRole ? { user: { platformRole } } : undefined }),
    }),
  }) as never;

describe("InternalStaffGuard (HU-23, CA-23.09)", () => {
  const guard = new InternalStaffGuard();

  it("permite OPERATOR", () => expect(guard.canActivate(ctx("OPERATOR"))).toBe(true));
  it("permite PLATFORM_ADMIN", () => expect(guard.canActivate(ctx("PLATFORM_ADMIN"))).toBe(true));
  it("rechaza sesión sin rol de plataforma (usuario institucional)", () =>
    expect(() => guard.canActivate(ctx())).toThrow(ForbiddenException));
  it("rechaza un rol desconocido", () =>
    expect(() => guard.canActivate(ctx("ANALYST"))).toThrow(ForbiddenException));
});
