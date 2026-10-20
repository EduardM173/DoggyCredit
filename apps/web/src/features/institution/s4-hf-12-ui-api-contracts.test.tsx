/* eslint-disable @typescript-eslint/no-explicit-any */
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluationDetail } from "./EvaluationDetail";

const mockDraftEvaluation = {
  id: "eval-draft-1",
  tenantId: "tenant-1",
  clientId: "client-1",
  clientName: "María Gutiérrez",
  documentType: "CI",
  documentNumber: "7654321",
  purpose: "WORKING_CAPITAL",
  requestedAmount: 20000,
  status: "DRAFT",
  ruleVersion: "1.0.0",
  createdAt: "2026-10-20T11:00:00Z",
  profile: null,
  recommendations: [],
  sourceResults: [],
};

const mockCompletedEvaluation = {
  ...mockDraftEvaluation,
  status: "COMPLETED",
  profile: {
    averageMonthlyIncome: 8000,
    averageMonthlyExpenses: 3000,
    disposableIncome: 5000,
    totalDebt: 2000,
    activeCredits: 1,
    debtToIncome: 0.25,
    hasRecentArrears: false,
    completeness: 1,
    profileVersion: "1.0.0",
    calculatedAt: "2026-10-20T11:05:00Z",
  },
};

const response = (data: unknown, status = 200) =>
  Promise.resolve({
    ok: status < 400,
    status,
    json: async () => data,
  });

const mountEvaluationDetail = (evalId = "eval-draft-1") => {
  const router = createMemoryRouter(
    [
      {
        path: "/:tenantSlug/evaluaciones/:id",
        element: <EvaluationDetail slug="banco-solidario" />,
      },
    ],
    { initialEntries: [`/banco-solidario/evaluaciones/${evalId}`] },
  );
  render(<RouterProvider router={router} />);
  return router;
};

describe("S4-HF-12 — Validar contratos UI-API y respuestas HTTP", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("Escenario 1: CTA principal ejecuta llamada real a API y actualiza la UI al completarse", async () => {
    fetchMock.mockImplementation((url: string, opts?: any) => {
      if (url.includes("/financial-integrations")) {
        return response({ items: [] });
      }
      if (url.endsWith("/process") && opts?.method === "POST") {
        return response(mockCompletedEvaluation);
      }
      if (url.includes("/evaluations/eval-draft-1")) {
        return response(mockDraftEvaluation);
      }
      return response({});
    });

    mountEvaluationDetail();

    await waitFor(() => {
      expect(screen.getByText("María Gutiérrez")).toBeInTheDocument();
      expect(screen.getByText("Iniciar evaluación")).toBeInTheDocument();
    });

    const ctaButton = screen.getByRole("button", { name: "Iniciar evaluación" });
    fireEvent.click(ctaButton);

    // Tras el procesamiento exitoso, cambia el estado a COMPLETADA
    await waitFor(() => {
      expect(screen.getByText("COMPLETADA")).toBeInTheDocument();
    });

    // Verifica que se llamó exactamente al endpoint POST /process
    const processCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/process"));
    expect(processCall).toBeDefined();
    expect(processCall?.[1]?.method).toBe("POST");
  });

  it("Escenario 2: maneja respuesta 409 (Conflicto / idempotencia) sin dejar la UI bloqueada", async () => {
    fetchMock.mockImplementation((url: string, opts?: any) => {
      if (url.includes("/financial-integrations")) {
        return response({ items: [] });
      }
      if (url.endsWith("/process") && opts?.method === "POST") {
        return response({ message: "La evaluación ya se encuentra en procesamiento o completada." }, 409);
      }
      if (url.includes("/evaluations/eval-draft-1")) {
        return response(mockDraftEvaluation);
      }
      return response({});
    });

    mountEvaluationDetail();

    await waitFor(() => {
      expect(screen.getByText("Iniciar evaluación")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Iniciar evaluación" }));

    await waitFor(() => {
      expect(screen.getByText(/La evaluación ya se encuentra en procesamiento o completada/)).toBeInTheDocument();
      // El botón vuelve a estar disponible (no queda en spinner eterno)
      expect(screen.getByRole("button", { name: "Iniciar evaluación" })).not.toBeDisabled();
    });
  });

  it("Escenario 3: maneja respuesta 403 (Sin cupo o sin permiso) mostrando mensaje de negocio", async () => {
    fetchMock.mockImplementation((url: string, opts?: any) => {
      if (url.includes("/financial-integrations")) {
        return response({ items: [] });
      }
      if (url.endsWith("/process") && opts?.method === "POST") {
        return response(
          { message: "Cupo mensual excedido. No se pueden iniciar nuevas evaluaciones bajo este plan." },
          403,
        );
      }
      if (url.includes("/evaluations/eval-draft-1")) {
        return response(mockDraftEvaluation);
      }
      return response({});
    });

    mountEvaluationDetail();

    await waitFor(() => {
      expect(screen.getByText("Iniciar evaluación")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Iniciar evaluación" }));

    await waitFor(() => {
      expect(screen.getByText(/Cupo mensual excedido/)).toBeInTheDocument();
    });
  });

  it("Escenario 4: maneja respuesta 500 (Fallo del servidor) permitiendo reintentar", async () => {
    fetchMock.mockImplementation((url: string, opts?: any) => {
      if (url.includes("/financial-integrations")) {
        return response({ items: [] });
      }
      if (url.endsWith("/process") && opts?.method === "POST") {
        return response({ message: "Error interno en el motor de reglas." }, 500);
      }
      if (url.includes("/evaluations/eval-draft-1")) {
        return response(mockDraftEvaluation);
      }
      return response({});
    });

    mountEvaluationDetail();

    await waitFor(() => {
      expect(screen.getByText("Iniciar evaluación")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Iniciar evaluación" }));

    await waitFor(() => {
      expect(screen.getByText(/Error interno en el motor de reglas/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Iniciar evaluación" })).toBeEnabled();
    });
  });
});
