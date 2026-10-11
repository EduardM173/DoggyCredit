import { jest } from "@jest/globals";
import { ClientsService } from "./clients.service.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockFn = jest.Mock<any>;

describe("ClientsService (HU-14)", () => {
  let service: ClientsService;
  let mockDb: {
    client: {
      client: {
        findUnique: MockFn;
        create: MockFn;
      };
    };
  };

  beforeEach(() => {
    mockDb = {
      client: {
        client: {
          findUnique: jest.fn(),
          create: jest.fn(),
        },
      },
    };
    service = new ClientsService(mockDb as unknown as DatabaseUnitOfWork);
  });

  describe("findByDocument()", () => {
    it("finds client by tenant, documentType and documentNumber", async () => {
      mockDb.client.client.findUnique.mockResolvedValueOnce({
        id: "c-1",
        tenantId: "tenant-a",
        type: "COMPANY",
        documentType: "NIT",
        documentNumber: "1234567890",
        name: "Acme Corp",
      });

      const result = await service.findByDocument(
        "tenant-a",
        "NIT",
        " 1234567890 ",
        "COMPANY",
      );

      expect(mockDb.client.client.findUnique).toHaveBeenCalledWith({
        where: {
          tenantId_documentType_documentNumber: {
            tenantId: "tenant-a",
            documentType: "NIT",
            documentNumber: "1234567890",
          },
        },
      });
      expect(result).not.toBeNull();
      expect(result?.name).toBe("Acme Corp");
    });

    it("returns null if found client type does not match requested type", async () => {
      mockDb.client.client.findUnique.mockResolvedValueOnce({
        id: "c-1",
        tenantId: "tenant-a",
        type: "PERSON",
        documentType: "CI",
        documentNumber: "1234567",
        name: "Juan Perez",
      });

      const result = await service.findByDocument(
        "tenant-a",
        "CI",
        "1234567",
        "COMPANY",
      );

      expect(result).toBeNull();
    });
  });

  describe("findOrCreate()", () => {
    it("returns existing client if already exists with matching type", async () => {
      mockDb.client.client.findUnique.mockResolvedValueOnce({
        id: "c-1",
        tenantId: "tenant-a",
        type: "COMPANY",
        documentType: "NIT",
        documentNumber: "1020304050",
        name: "Empresa S.A.",
      });

      const result = await service.findOrCreate("tenant-a", {
        type: "COMPANY",
        documentType: "NIT",
        documentNumber: "1020304050",
        name: "Empresa S.A.",
      });

      expect(result.created).toBe(false);
      expect(result.client.id).toBe("c-1");
      expect(mockDb.client.client.create).not.toHaveBeenCalled();
    });

    it("creates new company client with economicActivity", async () => {
      mockDb.client.client.findUnique.mockResolvedValueOnce(null);
      mockDb.client.client.create.mockResolvedValueOnce({
        id: "c-2",
        tenantId: "tenant-a",
        type: "COMPANY",
        documentType: "NIT",
        documentNumber: "9876543210",
        name: "Distribuidora Los Andes S.R.L.",
        economicActivity: "Venta al por mayor",
      });

      const result = await service.findOrCreate("tenant-a", {
        type: "COMPANY",
        documentType: "NIT",
        documentNumber: "9876543210",
        name: "Distribuidora Los Andes S.R.L.",
        economicActivity: "Venta al por mayor",
      });

      expect(result.created).toBe(true);
      expect(mockDb.client.client.create).toHaveBeenCalledWith({
        data: {
          tenantId: "tenant-a",
          type: "COMPANY",
          documentType: "NIT",
          documentNumber: "9876543210",
          name: "Distribuidora Los Andes S.R.L.",
          email: null,
          phone: null,
          address: null,
          economicActivity: "Venta al por mayor",
        },
      });
      expect(result.client.economicActivity).toBe("Venta al por mayor");
    });
  });
});
