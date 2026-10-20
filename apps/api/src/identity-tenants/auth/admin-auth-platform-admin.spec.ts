import { jest } from "@jest/globals";
import { ConfigService } from "@nestjs/config";
import type { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { AdminAuthService } from "./admin-auth.service.js";
import { hashPassword } from "./password-hashing.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
describe("HU-30 inicio de sesión de PLATFORM_ADMIN", () => {
  const build = async (platformRole: string | null) => {
    const user = {
      id: "u1",
      fullName: "Admin Plataforma",
      email: "admin@doggycredit.local",
      platformRole,
      status: "ACTIVE",
      platformAccessStatus: "ACTIVE",
      passwordHash: await hashPassword("clave-de-prueba-12345"),
    };
    const tx = {
      adminSession: { updateMany: jest.fn<any>(), create: jest.fn<any>() },
      user: { update: jest.fn<any>() },
    };
    const prisma = {
      user: { findUnique: jest.fn<any>().mockResolvedValue(user) },
      $transaction: async (work: (t: typeof tx) => Promise<void>) => work(tx),
    } as unknown as PrismaService;
    return new AdminAuthService(prisma, new ConfigService({ ADMIN_SESSION_TTL_MINUTES: 30 }));
  };

  it("admite OPERATOR y PLATFORM_ADMIN con la contraseña correcta", async () => {
    for (const role of ["OPERATOR", "PLATFORM_ADMIN"]) {
      const result = await (await build(role)).login("admin@doggycredit.local", "clave-de-prueba-12345");
      expect(result.view.user.platformRole).toBe(role);
    }
  });

  it("sigue rechazando usuarios sin rol de plataforma", async () => {
    await expect(
      (await build(null)).login("admin@doggycredit.local", "clave-de-prueba-12345"),
    ).rejects.toThrow("Credenciales incorrectas.");
  });
});
