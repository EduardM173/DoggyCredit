import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluationDetail } from "./EvaluationDetail";

const jsonResponse = (data: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  });

describe("HU-11 EvaluationDetail", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const mockDraftEvaluation = {
    id: "eval-100",
    tenantId: "tenant-1",
    clientId: "client-1",
    clientName: "Maria Lopez",
    documentType: "CI",
    documentNumber: "7891234",
    purpose: "WORKING_CAPITAL",
    requestedAmount: 15000,
    status: "DRAFT",
    consentGivenAt: "2026-10-10T20:00:00.000Z",
    applicantSnapshot: { name: "Maria Lopez", documentNumber: "7891234" },
    ruleVersion: "1.0.0",
    createdAt: "2026-10-10T20:00:00.000Z",
    failureCode: null,
    failureMessage: null,
    startedAt: null,
    completedAt: null,
    profile: null,
    sourceResults: [],
  };

  it("PA-11.1 & CA-11.02: shows draft, processes evaluation, and renders basic financial profile", async () => {
    // 1. Initial GET
    fetchMock.mockReturnValueOnce(jsonResponse(mockDraftEvaluation));

    const mockCompletedEvaluation = {
      ...mockDraftEvaluation,
      status: "COMPLETED",
      completedAt: "2026-10-10T20:05:00.000Z",
      profile: {
        id: "prof-1",
        averageMonthlyIncome: 6500,
        averageMonthlyExpenses: 2800,
        disposableIncome: 3700,
        totalDebt: 4200,
        activeCredits: 1,
        debtToIncome: 0.0692,
        hasRecentArrears: false,
        completeness: 1,
        profileVersion: "1.0.0",
        calculatedAt: "2026-10-10T20:05:00.000Z",
      },
      sourceResults: [
        {
          id: "sr-1",
          providerId: "p-bank",
          status: "SUCCESS",
          attemptCount: 1,
          externalReference: "BM-7891234-01",
          errorCode: null,
          requestedAt: "2026-10-10T20:04:00.000Z",
          respondedAt: "2026-10-10T20:05:00.000Z",
        },
      ],
    };

    // 2. POST process
    fetchMock.mockReturnValueOnce(jsonResponse(mockCompletedEvaluation));

    render(
      <MemoryRouter initialEntries={["/banco-demo/evaluaciones/eval-100"]}>
        <Routes>
          <Route path="/:tenantSlug/evaluaciones/:id" element={<EvaluationDetail slug="banco-demo" />} />
        </Routes>
      </MemoryRouter>,
    );

    // Initial load displays applicant summary and start button
    await waitFor(() => {
      expect(screen.getByText("Maria Lopez")).toBeInTheDocument();
      expect(screen.getByText("Iniciar evaluación")).toBeInTheDocument();
    });

    const startBtn = screen.getByText("Iniciar evaluación");
    fireEvent.click(startBtn);

    // After processing, renders completed financial profile
    await waitFor(() => {
      expect(screen.getByText("Perfil Financiero Básico")).toBeInTheDocument();
      expect(screen.getByText("COMPLETADA")).toBeInTheDocument();
      expect(screen.getByText("Bs. 6.500,00")).toBeInTheDocument();
      expect(screen.getByText("Bs. 2.800,00")).toBeInTheDocument();
      expect(screen.getByText("Bs. 3.700,00")).toBeInTheDocument();
      expect(screen.getByText("Bs. 4.200,00")).toBeInTheDocument();
      expect(screen.getByText("6.92%")).toBeInTheDocument();
      expect(screen.getByText("Sin mora registrada")).toBeInTheDocument();
      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    // Verify correct endpoints were called
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/institution/tenants/banco-demo/evaluations/eval-100/process"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("PA-11.2 & CA-11.09: renders informative notice when Bank Mock has NO_DATA (INCOMPLETE)", async () => {
    const mockIncompleteEvaluation = {
      ...mockDraftEvaluation,
      status: "INCOMPLETE",
      failureCode: "NO_FINANCIAL_DATA",
      failureMessage: "La fuente bancaria no dispone de antecedentes financieros para este solicitante.",
      profile: null,
      sourceResults: [
        {
          id: "sr-1",
          providerId: "p-bank",
          status: "NO_DATA",
          attemptCount: 1,
          externalReference: "BM-0000000-01",
          errorCode: null,
          requestedAt: "2026-10-10T20:00:00.000Z",
          respondedAt: "2026-10-10T20:00:01.000Z",
        },
      ],
    };

    fetchMock.mockReturnValueOnce(jsonResponse(mockIncompleteEvaluation));

    render(
      <MemoryRouter initialEntries={["/banco-demo/evaluaciones/eval-100"]}>
        <Routes>
          <Route path="/:tenantSlug/evaluaciones/:id" element={<EvaluationDetail slug="banco-demo" />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("INFORMACIÓN PARCIAL")).toBeInTheDocument();
      expect(screen.getByText("Fuente sin antecedentes disponibles")).toBeInTheDocument();
      expect(
        screen.getByText("La fuente bancaria no dispone de antecedentes financieros para este solicitante."),
      ).toBeInTheDocument();
    });
  });

  it("PA-11.5 & CA-11.18: allows retrying on the same evaluation when FAILED", async () => {
    const mockFailedEvaluation = {
      ...mockDraftEvaluation,
      status: "FAILED",
      failureCode: "BANK_UNAVAILABLE",
      failureMessage: "El servicio bancario externo no se encuentra disponible temporalmente.",
      profile: null,
      sourceResults: [],
    };

    fetchMock.mockReturnValueOnce(jsonResponse(mockFailedEvaluation));

    const mockRecoveredEvaluation = {
      ...mockDraftEvaluation,
      status: "COMPLETED",
      profile: {
        id: "prof-recovered",
        averageMonthlyIncome: 5000,
        averageMonthlyExpenses: 2000,
        disposableIncome: 3000,
        totalDebt: 0,
        activeCredits: 0,
        debtToIncome: 0,
        hasRecentArrears: false,
        completeness: 1,
        profileVersion: "1.0.0",
        calculatedAt: "2026-10-10T20:10:00.000Z",
      },
      sourceResults: [],
    };

    fetchMock.mockReturnValueOnce(jsonResponse(mockRecoveredEvaluation));

    render(
      <MemoryRouter initialEntries={["/banco-demo/evaluaciones/eval-100"]}>
        <Routes>
          <Route path="/:tenantSlug/evaluaciones/:id" element={<EvaluationDetail slug="banco-demo" />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("NO COMPLETADA")).toBeInTheDocument();
      expect(screen.getByText("Reintentar evaluación")).toBeInTheDocument();
    });

    const retryBtn = screen.getByText("Reintentar evaluación");
    fireEvent.click(retryBtn);

    await waitFor(() => {
      expect(screen.getByText("Perfil Financiero Básico")).toBeInTheDocument();
      expect(screen.getByText("COMPLETADA")).toBeInTheDocument();
    });

    // Verification that POST /process was triggered with the SAME evaluation ID
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/institution/tenants/banco-demo/evaluations/eval-100/process"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("CA-11.15: displays uncalculable metrics as 'No disponible' without rendering NaN or zeros", async () => {
    const mockPartialProfileEvaluation = {
      ...mockDraftEvaluation,
      status: "COMPLETED",
      profile: {
        id: "prof-partial",
        averageMonthlyIncome: 4000,
        averageMonthlyExpenses: null,
        disposableIncome: null,
        totalDebt: null,
        activeCredits: null,
        debtToIncome: null,
        hasRecentArrears: null,
        completeness: 0.1429,
        profileVersion: "1.0.0",
        calculatedAt: "2026-10-10T20:10:00.000Z",
      },
      sourceResults: [],
    };

    fetchMock.mockReturnValueOnce(jsonResponse(mockPartialProfileEvaluation));

    render(
      <MemoryRouter initialEntries={["/banco-demo/evaluaciones/eval-100"]}>
        <Routes>
          <Route path="/:tenantSlug/evaluaciones/:id" element={<EvaluationDetail slug="banco-demo" />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Bs. 4.000,00")).toBeInTheDocument();
      const noAvailableElements = screen.getAllByText("No disponible");
      expect(noAvailableElements.length).toBeGreaterThan(0);
      expect(screen.queryByText("NaN")).not.toBeInTheDocument();
      expect(screen.queryByText("undefined")).not.toBeInTheDocument();
      expect(screen.queryByText("null")).not.toBeInTheDocument();
    });
  });
});
