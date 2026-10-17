import { jest } from "@jest/globals";
import type { Response } from "express";
import { EvaluationsController } from "./evaluations.controller.js";
import type { EvaluationsService } from "./evaluations.service.js";
import { ClientTypeDto, DocumentTypeDto } from "./dto/create-evaluation.dto.js";
import type { TenantRequest } from "../identity-tenants/public.js";

describe("EvaluationsController client search", () => {
  const request = { tenantContext: { tenantId: "tenant-a" } } as TenantRequest;

  it("returns no content when the applicant has no dossier", async () => {
    const searchClient = jest.fn(async () => null);
    const status = jest.fn();
    const controller = new EvaluationsController({ searchClient } as unknown as EvaluationsService);

    const result = await controller.searchClient(
      request,
      DocumentTypeDto.CI,
      "343243253252",
      ClientTypeDto.PERSON,
      { status } as unknown as Response,
    );

    expect(result).toBeNull();
    expect(status).toHaveBeenCalledWith(204);
  });

  it("keeps a found dossier as a normal JSON response", async () => {
    const dossier = { id: "client-a", name: "Ana López" };
    const searchClient = jest.fn(async () => dossier);
    const status = jest.fn();
    const controller = new EvaluationsController({ searchClient } as unknown as EvaluationsService);

    const result = await controller.searchClient(
      request,
      DocumentTypeDto.CI,
      "1234567",
      ClientTypeDto.PERSON,
      { status } as unknown as Response,
    );

    expect(result).toEqual(dossier);
    expect(status).not.toHaveBeenCalled();
  });
});
