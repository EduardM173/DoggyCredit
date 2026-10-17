import { jest } from "@jest/globals";
import { ServiceUnavailableException } from "@nestjs/common";
import { BureauMockSourceService } from "./bureau-mock-source.service.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockFn = jest.Mock<any>;

describe("BureauMockSourceService (HU-13 / S3-RF-01)", () => {
  let service: BureauMockSourceService;
  let mockDb: {
    client: {
      integrationProvider: {
        findUnique: MockFn;
      };
      tenantIntegration: {
        findUnique: MockFn;
        upsert: MockFn;
      };
    };
  };

  beforeEach(() => {
    mockDb = {
      client: {
        integrationProvider: {
          findUnique: jest.fn(),
        },
        tenantIntegration: {
          findUnique: jest.fn(),
        },
      },
    } as any;
    mockDb.client.tenantIntegration.upsert = jest.fn();
    service = new BureauMockSourceService(mockDb as unknown as DatabaseUnitOfWork);
  });

  describe("status", () => {
    it("returns inactive and unavailable when BUREAU_MOCK provider is not found", async () => {
      mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce(null);

      const res = await service.status("tenant-1");
      expect(res).toEqual({
        available: false,
        enabled: false,
        healthStatus: "INACTIVE",
      });
    });

    it("returns available: false and healthStatus INACTIVE when provider is INACTIVE", async () => {
      mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce({
        id: "prov-bureau-1",
        status: "INACTIVE",
      });

      const res = await service.status("tenant-1");
      expect(res).toEqual({
        available: false,
        enabled: false,
        healthStatus: "INACTIVE",
      });
    });

    it("returns available: true but enabled: false when tenant has not enabled bureau", async () => {
      mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce({
        id: "prov-bureau-1",
        status: "ACTIVE",
      });
      mockDb.client.tenantIntegration.findUnique.mockResolvedValueOnce(null);

      const res = await service.status("tenant-1");
      expect(res).toEqual({
        available: true,
        enabled: false,
        healthStatus: "ACTIVE",
      });
    });

    it("returns enabled: true when tenant has enabled bureau and provider is ACTIVE", async () => {
      mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce({
        id: "prov-bureau-1",
        status: "ACTIVE",
      });
      mockDb.client.tenantIntegration.findUnique.mockResolvedValueOnce({
        enabled: true,
        status: "ACTIVE",
      });

      const res = await service.status("tenant-1");
      expect(res).toEqual({
        available: true,
        enabled: true,
        healthStatus: "ACTIVE",
      });
    });
  });

  describe("enable", () => {
    it("throws ServiceUnavailableException when provider is missing or not active", async () => {
      mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce({
        id: "prov-bureau-1",
        status: "INACTIVE",
      });

      await expect(service.enable("tenant-1", true)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it("upserts tenantIntegration with enabled: true when enabling", async () => {
      mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce({
        id: "prov-bureau-1",
        status: "ACTIVE",
      });
      mockDb.client.tenantIntegration.findUnique.mockResolvedValueOnce({
        enabled: false,
        status: "ACTIVE",
      });
      mockDb.client.tenantIntegration.upsert.mockResolvedValueOnce({
        tenantId: "tenant-1",
        providerId: "prov-bureau-1",
        enabled: true,
      });

      const changed = await service.enable("tenant-1", true);
      expect(changed).toBe(true);
      expect(mockDb.client.tenantIntegration.upsert).toHaveBeenCalledWith({
        where: {
          tenantId_providerId: { tenantId: "tenant-1", providerId: "prov-bureau-1" },
        },
        update: { enabled: true, status: "ACTIVE", lastErrorCode: null },
        create: {
          tenantId: "tenant-1",
          providerId: "prov-bureau-1",
          enabled: true,
          status: "ACTIVE",
        },
      });
    });

    it("returns false if tenant already has bureau enabled", async () => {
      mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce({
        id: "prov-bureau-1",
        status: "ACTIVE",
      });
      mockDb.client.tenantIntegration.findUnique.mockResolvedValueOnce({
        enabled: true,
        status: "ACTIVE",
      });

      const changed = await service.enable("tenant-1", true);
      expect(changed).toBe(false);
      expect(mockDb.client.tenantIntegration.upsert).not.toHaveBeenCalled();
    });

    it("can disable bureau mock when requested", async () => {
      mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce({
        id: "prov-bureau-1",
        status: "ACTIVE",
      });
      mockDb.client.tenantIntegration.findUnique.mockResolvedValueOnce({
        enabled: true,
        status: "ACTIVE",
      });
      mockDb.client.tenantIntegration.upsert.mockResolvedValueOnce({
        tenantId: "tenant-1",
        providerId: "prov-bureau-1",
        enabled: false,
      });

      const changed = await service.enable("tenant-1", false);
      expect(changed).toBe(true);
      expect(mockDb.client.tenantIntegration.upsert).toHaveBeenCalledWith({
        where: {
          tenantId_providerId: { tenantId: "tenant-1", providerId: "prov-bureau-1" },
        },
        update: { enabled: false, status: "ACTIVE", lastErrorCode: null },
        create: {
          tenantId: "tenant-1",
          providerId: "prov-bureau-1",
          enabled: false,
          status: "ACTIVE",
        },
      });
    });
  });

  describe("query", () => {
    it("throws ServiceUnavailableException when provider is missing or inactive", async () => {
      mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce(null);

      await expect(service.query("tenant-1", "1234567")).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it("throws ServiceUnavailableException when tenant has not enabled bureau", async () => {
      mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce({
        id: "prov-bureau-1",
        status: "ACTIVE",
      });
      mockDb.client.tenantIntegration.findUnique.mockResolvedValueOnce(null);

      await expect(service.query("tenant-1", "1234567")).rejects.toThrow(
        ServiceUnavailableException,
      );
    });

    it("returns UNAVAILABLE for document ending with 999", async () => {
      mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce({
        id: "prov-bureau-1",
        status: "ACTIVE",
      });
      mockDb.client.tenantIntegration.findUnique.mockResolvedValueOnce({
        enabled: true,
        status: "ACTIVE",
      });

      const res = await service.query("tenant-1", "1234999");
      expect(res.status).toBe("UNAVAILABLE");
      if (res.status === "UNAVAILABLE") {
        expect(res.errorCode).toBe("BUREAU_UNAVAILABLE");
        expect(res.retryable).toBe(true);
      }
    });

    it("returns NO_DATA for document ending with 000", async () => {
      mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce({
        id: "prov-bureau-1",
        status: "ACTIVE",
      });
      mockDb.client.tenantIntegration.findUnique.mockResolvedValueOnce({
        enabled: true,
        status: "ACTIVE",
      });

      const res = await service.query("tenant-1", "1234000");
      expect(res.status).toBe("NO_DATA");
    });

    it("returns SUCCESS with clean history for standard document", async () => {
      mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce({
        id: "prov-bureau-1",
        status: "ACTIVE",
      });
      mockDb.client.tenantIntegration.findUnique.mockResolvedValueOnce({
        enabled: true,
        status: "ACTIVE",
      });

      const res = await service.query("tenant-1", "1234567");
      expect(res.status).toBe("SUCCESS");
      if (res.status === "SUCCESS") {
        expect(res.data.hasRecentArrears).toBe(false);
        expect(res.data.totalSystemDebt).toBe(18000);
      }
    });
  });
});
