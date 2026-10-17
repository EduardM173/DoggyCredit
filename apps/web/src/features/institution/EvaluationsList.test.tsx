import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluationsList } from "./EvaluationsList";

const jsonResponse = (data: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  });

describe("HU-18 EvaluationsList — Consultar historial y estados de evaluaciones", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const sampleEvaluations = [
    {
      id: "eval-101",
      tenantId: "tenant-demo",
      clientId: "client-1",
      clientName: "Maria Lopez",
      documentType: "CI",
      documentNumber: "7891234",
      purpose: "WORKING_CAPITAL",
      requestedAmount: 15000,
      status: "COMPLETED",
      consentGivenAt: "2026-10-10T20:00:00.000Z",
      applicantSnapshot: { name: "Maria Lopez" },
      ruleVersion: "1.0.0",
      createdAt: "2026-10-10T20:00:00.000Z",
    },
    {
      id: "eval-102",
      tenantId: "tenant-demo",
      clientId: "client-2",
      clientName: "Industrias Cochabamba SRL",
      documentType: "NIT",
      documentNumber: "3040506070",
      purpose: "BUSINESS_INVESTMENT",
      requestedAmount: 80000,
      status: "IN_PROGRESS",
      consentGivenAt: "2026-10-10T21:00:00.000Z",
      applicantSnapshot: { name: "Industrias Cochabamba SRL" },
      ruleVersion: "1.0.0",
      createdAt: "2026-10-10T21:00:00.000Z",
    },
    {
      id: "eval-103",
      tenantId: "tenant-demo",
      clientId: "client-3",
      clientName: "Juan Perez",
      documentType: "CI",
      documentNumber: "4567890",
      purpose: "EQUIPMENT",
      requestedAmount: 20000,
      status: "INCOMPLETE",
      consentGivenAt: "2026-10-10T21:30:00.000Z",
      applicantSnapshot: { name: "Juan Perez" },
      ruleVersion: "1.0.0",
      createdAt: "2026-10-10T21:30:00.000Z",
    },
    {
      id: "eval-104",
      tenantId: "tenant-demo",
      clientId: "client-4",
      clientName: "Transportes La Paz SRL",
      documentType: "NIT",
      documentNumber: "9080706050",
      purpose: "WORKING_CAPITAL",
      requestedAmount: 50000,
      status: "FAILED",
      consentGivenAt: "2026-10-10T22:00:00.000Z",
      applicantSnapshot: { name: "Transportes La Paz SRL" },
      ruleVersion: "1.0.0",
      createdAt: "2026-10-10T22:00:00.000Z",
    },
  ];

  it("PA-18.01 & CA-18.01: displays historical evaluations with subject, date, purpose, amount, and original result", async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse({
        items: sampleEvaluations,
        total: 4,
        page: 1,
        limit: 10,
        totalPages: 1,
      }),
    );

    render(
      <MemoryRouter initialEntries={["/banco-demo/evaluaciones"]}>
        <Routes>
          <Route
            path="/:tenantSlug/evaluaciones"
            element={<EvaluationsList slug="banco-demo" tenantName="Banco Demo" ready={true} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Maria Lopez")).toBeInTheDocument();
      expect(screen.getByText(/CI:\s*7891234/)).toBeInTheDocument();
      expect(screen.getAllByText("Capital de trabajo").length).toBeGreaterThan(0);
      expect(screen.getByText("Bs. 15.000,00")).toBeInTheDocument();
      expect(screen.getByText("Industrias Cochabamba SRL")).toBeInTheDocument();
      expect(screen.getByText(/NIT:\s*3040506070/)).toBeInTheDocument();
      expect(screen.getByText("Inversión")).toBeInTheDocument();
      expect(screen.getByText("Bs. 80.000,00")).toBeInTheDocument();
    });

    // Verification: links lead to detail with contextual actions without exposing technical IDs in text
    expect(screen.getByRole("link", { name: "Ver resultado" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ver estado" })).toBeInTheDocument();
  });

  it("PA-18.02 & CA-18.03: renders empty list when tenant has no evaluations, offering to create first evaluation", async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse({
        items: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 1,
      }),
    );

    render(
      <MemoryRouter initialEntries={["/banco-demo/evaluaciones"]}>
        <Routes>
          <Route
            path="/:tenantSlug/evaluaciones"
            element={<EvaluationsList slug="banco-demo" tenantName="Banco Demo" ready={true} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("No hay evaluaciones registradas")).toBeInTheDocument();
      expect(screen.getByText("Iniciar primera evaluación")).toBeInTheDocument();
      expect(
        screen.queryByText("No se encontraron coincidencias para los filtros aplicados"),
      ).not.toBeInTheDocument();
    });
  });

  it("PA-18.02 & CA-18.03: distinguishes search with no matches and provides a button to clear filters without forcing creation", async () => {
    // 1. Initial filtered fetch returning 0 matches
    fetchMock.mockReturnValueOnce(
      jsonResponse({
        items: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 1,
      }),
    );

    render(
      <MemoryRouter initialEntries={["/banco-demo/evaluaciones?search=Inexistente"]}>
        <Routes>
          <Route
            path="/:tenantSlug/evaluaciones"
            element={<EvaluationsList slug="banco-demo" tenantName="Banco Demo" ready={true} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText("No se encontraron coincidencias para los filtros aplicados"),
      ).toBeInTheDocument();
      expect(screen.queryByText("No hay evaluaciones registradas")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Limpiar búsqueda y filtros" })).toBeInTheDocument();
    });

    // 2. Click button to clear filters -> fetches without search filter
    fetchMock.mockReturnValueOnce(
      jsonResponse({
        items: sampleEvaluations,
        total: 4,
        page: 1,
        limit: 10,
        totalPages: 1,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda y filtros" }));

    await waitFor(() => {
      expect(screen.getByText("Maria Lopez")).toBeInTheDocument();
    });
  });

  it("PA-18.03 & CA-18.04 & CA-18.06: differentiates statuses with icon + text and presents FAILED as technical issue, not credit rejection", async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse({
        items: sampleEvaluations,
        total: 4,
        page: 1,
        limit: 10,
        totalPages: 1,
      }),
    );

    render(
      <MemoryRouter initialEntries={["/banco-demo/evaluaciones"]}>
        <Routes>
          <Route
            path="/:tenantSlug/evaluaciones"
            element={<EvaluationsList slug="banco-demo" tenantName="Banco Demo" ready={true} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Completada")).toBeInTheDocument();
      expect(screen.getByText("En proceso")).toBeInTheDocument();
      expect(screen.getByText("Información parcial")).toBeInTheDocument();
      expect(screen.getByText("Fallo técnico")).toBeInTheDocument();
      // Verify FAILED is never communicated as credit rejection
      expect(screen.queryByText("Rechazada")).not.toBeInTheDocument();
      expect(screen.queryByText("Crédito denegado")).not.toBeInTheDocument();
    });
  });

  it("PA-18.05 & CA-18.09: provides contextual actions according to status ('Ver estado' for IN_PROGRESS)", async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse({
        items: sampleEvaluations,
        total: 4,
        page: 1,
        limit: 10,
        totalPages: 1,
      }),
    );

    render(
      <MemoryRouter initialEntries={["/banco-demo/evaluaciones"]}>
        <Routes>
          <Route
            path="/:tenantSlug/evaluaciones"
            element={<EvaluationsList slug="banco-demo" tenantName="Banco Demo" ready={true} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      // IN_PROGRESS evaluation (eval-102) has action "Ver estado"
      const statusLink = screen.getByRole("link", { name: "Ver estado" });
      expect(statusLink).toBeInTheDocument();
      expect(statusLink).toHaveAttribute("href", "/banco-demo/evaluaciones/eval-102");

      // COMPLETED has "Ver resultado"
      const completedLink = screen.getByRole("link", { name: "Ver resultado" });
      expect(completedLink).toHaveAttribute("href", "/banco-demo/evaluaciones/eval-101");

      // FAILED has "Reintentar"
      const retryLink = screen.getByRole("link", { name: "Reintentar" });
      expect(retryLink).toHaveAttribute("href", "/banco-demo/evaluaciones/eval-104");

      // INCOMPLETE has "Ver detalle"
      const detailLink = screen.getByRole("link", { name: "Ver detalle" });
      expect(detailLink).toHaveAttribute("href", "/banco-demo/evaluaciones/eval-103");
    });
  });

  it("PA-18.04 & CA-18.02 & CA-18.08: supports pagination and preserves search/status parameters", async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse({
        items: sampleEvaluations.slice(0, 2),
        total: 4,
        page: 1,
        limit: 2,
        totalPages: 2,
      }),
    );

    render(
      <MemoryRouter initialEntries={["/banco-demo/evaluaciones?search=Maria&status=COMPLETED"]}>
        <Routes>
          <Route
            path="/:tenantSlug/evaluaciones"
            element={<EvaluationsList slug="banco-demo" tenantName="Banco Demo" ready={true} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Página 1 de 2 (4 casos registrados)")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Siguiente/i })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Anterior/i })).toBeDisabled();
    });

    // Verify correct query parameters were passed to backend
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("search=Maria"),
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("status=COMPLETED"),
      expect.anything(),
    );
  });
});
