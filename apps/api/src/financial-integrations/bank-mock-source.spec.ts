import { jest } from "@jest/globals";
import { ServiceUnavailableException } from "@nestjs/common";
import { BankMockSourceService } from "./bank-mock-source.service.js";
import type { DatabaseUnitOfWork } from "../infrastructure/prisma/database-unit-of-work.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type MockFn = jest.Mock<any>;

describe("BankMockSourceService (S2-RF-01)", () => {
  let service: BankMockSourceService;
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
          upsert: jest.fn(),
        },
      },
    };
    service = new BankMockSourceService(mockDb as unknown as DatabaseUnitOfWork);
  });

  it("throws ServiceUnavailableException when provider is not active", async () => {
    mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce({
      id: "p-1",
      status: "INACTIVE",
    });

    await expect(service.query("tenant-1", "1234567")).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it("throws ServiceUnavailableException when tenant has not enabled Bank Mock", async () => {
    mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce({
      id: "p-1",
      status: "ACTIVE",
    });
    mockDb.client.tenantIntegration.findUnique.mockResolvedValueOnce(null);

    await expect(service.query("tenant-1", "1234567")).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it("returns SUCCESS with normalized accounts and loans for standard document", async () => {
    mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce({
      id: "p-1",
      status: "ACTIVE",
    });
    mockDb.client.tenantIntegration.findUnique.mockResolvedValueOnce({
      enabled: true,
      status: "ACTIVE",
    });

    const res = await service.query("tenant-1", "6849201");
    expect(res.status).toBe("SUCCESS");
    if (res.status === "SUCCESS") {
      expect(res.data.documentNumber).toBe("6849201");
      expect(res.data.accounts.length).toBeGreaterThan(0);
      expect(res.data.accounts[0].averageMonthlyInflow).toBe(6500.0);
      expect(res.data.loans.length).toBeGreaterThan(0);
      expect(res.data.loans[0].outstandingBalance).toBe(4200.0);
    }
  });

  it("returns NO_DATA for document ending in 000", async () => {
    mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce({
      id: "p-1",
      status: "ACTIVE",
    });
    mockDb.client.tenantIntegration.findUnique.mockResolvedValueOnce({
      enabled: true,
      status: "ACTIVE",
    });

    const res = await service.query("tenant-1", "1234000");
    expect(res.status).toBe("NO_DATA");
  });

  it("returns UNAVAILABLE for document ending in 999", async () => {
    mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce({
      id: "p-1",
      status: "ACTIVE",
    });
    mockDb.client.tenantIntegration.findUnique.mockResolvedValueOnce({
      enabled: true,
      status: "ACTIVE",
    });

    const res = await service.query("tenant-1", "888999");
    expect(res.status).toBe("UNAVAILABLE");
    if (res.status === "UNAVAILABLE") {
      expect(res.retryable).toBe(true);
      expect(res.errorCode).toBe("BANK_UNAVAILABLE");
    }
  });

  it("returns ERROR for document ending in 500", async () => {
    mockDb.client.integrationProvider.findUnique.mockResolvedValueOnce({
      id: "p-1",
      status: "ACTIVE",
    });
    mockDb.client.tenantIntegration.findUnique.mockResolvedValueOnce({
      enabled: true,
      status: "ACTIVE",
    });

    const res = await service.query("tenant-1", "777500");
    expect(res.status).toBe("ERROR");
    if (res.status === "ERROR") {
      expect(res.retryable).toBe(true);
      expect(res.errorCode).toBe("BANK_TIMEOUT");
    }
  });
});
