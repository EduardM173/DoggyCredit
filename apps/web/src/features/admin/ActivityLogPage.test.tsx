import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdminActivityLogPage } from "./ActivityLogPage";
import * as api from "./api";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    fetchPlatformAudit: vi.fn(),
  };
});

describe("HU-24 AdminActivityLogPage (Operator Platform Audit)", () => {
  const mockPlatformPage: api.PlatformAuditPage = {
    total: 2,
    page: 1,
    pageSize: 15,
    totalPages: 1,
    items: [
      {
        id: "plat-1",
        occurredAt: "2026-10-17T09:00:00.000Z",
        action: "PROVIDER_GLOBALLY_DISABLED",
        actionLabel: "Corte global de proveedor",
        category: "PLATFORM",
        outcome: "FAILURE",
        entityType: "IntegrationProvider",
        entityLabel: "Proveedor externo",
        entityId: "bureau-mock-id",
        resourceLink: "/admin/proveedores",
        actor: {
          type: "OPERATOR",
          name: "Operador Principal",
          email: "operador@doggycredit.com",
        },
        summary: "Corte de emergencia del proveedor BUREAU_MOCK: Mantenimiento programado.",
        metadata: { providerCode: "BUREAU_MOCK", reason: "Mantenimiento programado" },
      },
      {
        id: "plat-2",
        occurredAt: "2026-10-17T08:30:00.000Z",
        action: "TENANT_PROVISIONED",
        actionLabel: "Institución aprovisionada",
        category: "OPERATIONS",
        outcome: "SUCCESS",
        entityType: "Tenant",
        entityLabel: "Institución",
        entityId: "tenant-uuid-1",
        resourceLink: "/admin/instituciones/tenant-uuid-1",
        actor: {
          type: "SYSTEM",
          name: "Sistema automático",
        },
        summary: "Aprovisionamiento automático exitoso con plan PROFESSIONAL.",
        metadata: { planId: "PROFESSIONAL" },
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renderiza banner de privacidad operativa y lista de eventos de plataforma", async () => {
    vi.mocked(api.fetchPlatformAudit).mockResolvedValueOnce(mockPlatformPage);

    render(
      <MemoryRouter>
        <AdminActivityLogPage />
      </MemoryRouter>,
    );

    // CA-24.04: Banner de Privacidad Operativa
    expect(
      screen.getByText(/Privacidad operativa garantizada \(RF-05 \/ CA-24.04\)/i),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Corte global de proveedor")).toBeInTheDocument();
      expect(screen.getByText("Institución aprovisionada")).toBeInTheDocument();
    });

    expect(screen.getByText("Operador Principal")).toBeInTheDocument();
    expect(screen.getByText("operador@doggycredit.com")).toBeInTheDocument();
    expect(screen.getByText("Sistema automático")).toBeInTheDocument();

    const links = screen.getAllByRole("link", { name: "Ver" });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/admin/proveedores");
    expect(links[1]).toHaveAttribute("href", "/admin/instituciones/tenant-uuid-1");
  });

  it("permite filtrar por categoría y por ID de institución", async () => {
    vi.mocked(api.fetchPlatformAudit).mockResolvedValue(mockPlatformPage);

    render(
      <MemoryRouter>
        <AdminActivityLogPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Institución aprovisionada")).toBeInTheDocument();
    });

    const categorySelect = screen.getByLabelText(/Categoría de evento/i);
    fireEvent.change(categorySelect, { target: { value: "PLATFORM" } });

    await waitFor(() => {
      expect(api.fetchPlatformAudit).toHaveBeenCalledWith(
        expect.objectContaining({ category: "PLATFORM" }),
        expect.any(AbortSignal),
      );
    });

    const tenantInput = screen.getByLabelText(/Filtro por ID de institución/i);
    fireEvent.change(tenantInput, { target: { value: "tenant-sol-uuid" } });

    await waitFor(() => {
      expect(api.fetchPlatformAudit).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "tenant-sol-uuid" }),
        expect.any(AbortSignal),
      );
    });
  });
});
