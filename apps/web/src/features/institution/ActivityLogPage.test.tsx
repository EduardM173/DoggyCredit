import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityLogPage } from "./ActivityLogPage";
import * as api from "./api";

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    fetchInstitutionAudit: vi.fn(),
  };
});

describe("HU-24 ActivityLogPage (Institution Activity)", () => {
  const mockAuditPage: api.AuditPage = {
    total: 2,
    page: 1,
    pageSize: 15,
    totalPages: 1,
    items: [
      {
        id: "event-1",
        occurredAt: "2026-10-18T14:30:00.000Z",
        action: "EVALUATION_PROCESSED",
        actionLabel: "Evaluación crediticia procesada",
        category: "EVALUATION",
        outcome: "SUCCESS",
        entityType: "Evaluation",
        entityLabel: "Evaluación crediticia",
        entityId: "eval-101",
        resourceLink: "/banco-sol/evaluaciones/eval-101",
        actor: {
          type: "USER",
          name: "Carlos Analista",
          email: "carlos@bancosol.com",
        },
        summary: "Evaluación crediticia completada con dictamen final: COMPLETED.",
        metadata: { finalStatus: "COMPLETED" },
      },
      {
        id: "event-2",
        occurredAt: "2026-10-18T10:15:00.000Z",
        action: "PRODUCT_UPDATED",
        actionLabel: "Producto crediticio modificado",
        category: "CATALOG",
        outcome: "SUCCESS",
        entityType: "FinancialProduct",
        entityLabel: "Producto crediticio",
        entityId: "prod-202",
        resourceLink: "/banco-sol/productos",
        actor: {
          type: "USER",
          name: "Ana Administradora",
          email: "ana@bancosol.com",
        },
        summary: "Se modificaron los parámetros y políticas del producto.",
        metadata: null,
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renderiza lista de eventos de auditoría con actor, acción y enlaces", async () => {
    vi.mocked(api.fetchInstitutionAudit).mockResolvedValueOnce(mockAuditPage);

    render(
      <MemoryRouter>
        <ActivityLogPage slug="banco-sol" tenantName="Banco Solidario S.A." />
      </MemoryRouter>,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/Cargando registros/i);

    await waitFor(() => {
      expect(screen.getByText("Evaluación crediticia procesada")).toBeInTheDocument();
      expect(screen.getByText("Producto crediticio modificado")).toBeInTheDocument();
    });

    expect(screen.getByText("Carlos Analista")).toBeInTheDocument();
    expect(screen.getByText("carlos@bancosol.com")).toBeInTheDocument();
    expect(screen.getByText("Ana Administradora")).toBeInTheDocument();
    expect(screen.getByText(/eventos registrados/i)).toBeInTheDocument();

    const links = screen.getAllByRole("link", { name: "Ver" });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/banco-sol/evaluaciones/eval-101");
    expect(links[1]).toHaveAttribute("href", "/banco-sol/productos");
  });

  it("permite filtrar por categoría y fecha, y limpiar filtros", async () => {
    vi.mocked(api.fetchInstitutionAudit).mockResolvedValue(mockAuditPage);

    render(
      <MemoryRouter>
        <ActivityLogPage slug="banco-sol" tenantName="Banco Solidario S.A." />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Evaluación crediticia procesada")).toBeInTheDocument();
    });

    const categorySelect = screen.getByLabelText(/Categoría de evento/i);
    fireEvent.change(categorySelect, { target: { value: "CATALOG" } });

    await waitFor(() => {
      expect(api.fetchInstitutionAudit).toHaveBeenCalledWith(
        "banco-sol",
        expect.objectContaining({ category: "CATALOG" }),
        expect.any(AbortSignal),
      );
    });

    const resetButton = screen.getByRole("button", { name: /Limpiar filtros/i });
    fireEvent.click(resetButton);

    await waitFor(() => {
      expect(categorySelect).toHaveValue("");
      expect(api.fetchInstitutionAudit).toHaveBeenCalledWith(
        "banco-sol",
        expect.objectContaining({ category: undefined }),
        expect.any(AbortSignal),
      );
    });
  });

  it("muestra estado vacío cuando no hay eventos", async () => {
    vi.mocked(api.fetchInstitutionAudit).mockResolvedValueOnce({
      total: 0,
      page: 1,
      pageSize: 15,
      totalPages: 1,
      items: [],
    });

    render(
      <MemoryRouter>
        <ActivityLogPage slug="banco-sol" tenantName="Banco Solidario S.A." />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/No se encontraron eventos auditados/i)).toBeInTheDocument();
    });
  });

  it("muestra error y permite reintentar cuando la consulta falla", async () => {
    vi.mocked(api.fetchInstitutionAudit)
      .mockRejectedValueOnce(new Error("Fallo de conexión"))
      .mockResolvedValueOnce(mockAuditPage);

    render(
      <MemoryRouter>
        <ActivityLogPage slug="banco-sol" tenantName="Banco Solidario S.A." />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Fallo de conexión/i);
    });

    const retryButton = screen.getByRole("button", { name: /Reintentar/i });
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(screen.getByText("Evaluación crediticia procesada")).toBeInTheDocument();
    });
  });
});
