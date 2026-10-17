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
    recommendations: [],
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

  it("PA-12.1 & CA-12.06 & CA-12.12: renders recommended product with explainable reasons and official disclaimer", async () => {
    const mockRecommendedEvaluation = {
      ...mockDraftEvaluation,
      status: "COMPLETED",
      completedAt: "2026-10-10T20:20:00.000Z",
      ruleVersion: "1.0.0",
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
        calculatedAt: "2026-10-10T20:20:00.000Z",
      },
      recommendations: [
        {
          id: "rec-1",
          productId: "prod-1",
          productName: "Microcrédito Emprendedor",
          category: "MICRO_CREDIT",
          outcome: "RECOMMENDED",
          ruleVersion: "1.0.0",
          minAmount: 5000,
          maxAmount: 50000,
          evaluatedAt: "2026-10-10T20:20:00.000Z",
          reasons: [
            {
              code: "RULE_PURPOSE",
              message: "Finalidad del crédito admitida para este producto.",
              passed: true,
            },
            {
              code: "RULE_AMOUNT_RANGE",
              message: "Monto solicitado dentro del rango permitido (Bs. 5.000 - Bs. 50.000).",
              passed: true,
            },
            {
              code: "RULE_MAX_DTI",
              message: "Relación deuda/ingreso (6.9%) dentro del límite admisible (máximo 40%).",
              passed: true,
            },
          ],
        },
      ],
      sourceResults: [],
    };

    fetchMock.mockReturnValueOnce(jsonResponse(mockRecommendedEvaluation));

    render(
      <MemoryRouter initialEntries={["/banco-demo/evaluaciones/eval-100"]}>
        <Routes>
          <Route path="/:tenantSlug/evaluaciones/:id" element={<EvaluationDetail slug="banco-demo" />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Recomendación de Productos Crediticios")).toBeInTheDocument();
      expect(
        screen.getByText("Recomendación de Productos Crediticios").compareDocumentPosition(
          screen.getByText("Perfil Financiero Básico"),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(screen.getByText("Microcrédito Emprendedor")).toBeInTheDocument();
      expect(screen.getByText("Compatible")).toBeInTheDocument();
      expect(screen.getByText("Finalidad del crédito admitida para este producto.")).toBeInTheDocument();
      expect(screen.getByText("Monto solicitado dentro del rango permitido (Bs. 5.000 - Bs. 50.000).")).toBeInTheDocument();
      expect(screen.getByText(/Este resultado constituye una recomendación técnica/)).toBeInTheDocument();
      expect(screen.getByText("Nueva evaluación")).toBeInTheDocument();
      expect(screen.getByText("Ver evaluaciones")).toBeInTheDocument();
    });
  });

  it("PA-12.2 & CA-12.09 & CA-12.10: renders friendly notice when no product is compatible without error/failure", async () => {
    const mockNoCompatEvaluation = {
      ...mockDraftEvaluation,
      status: "COMPLETED",
      completedAt: "2026-10-10T20:25:00.000Z",
      ruleVersion: "1.0.0",
      profile: {
        id: "prof-1",
        averageMonthlyIncome: 3000,
        averageMonthlyExpenses: 2500,
        disposableIncome: 500,
        totalDebt: 5000,
        activeCredits: 2,
        debtToIncome: 0.65,
        hasRecentArrears: true,
        completeness: 1,
        profileVersion: "1.0.0",
        calculatedAt: "2026-10-10T20:25:00.000Z",
      },
      recommendations: [
        {
          id: "rec-1",
          productId: "prod-1",
          productName: "Microcrédito Emprendedor",
          category: "MICRO_CREDIT",
          outcome: "NOT_COMPATIBLE",
          ruleVersion: "1.0.0",
          minAmount: 5000,
          maxAmount: 50000,
          evaluatedAt: "2026-10-10T20:25:00.000Z",
          reasons: [
            {
              code: "RULE_MAX_DTI",
              message: "Relación deuda/ingreso (65.0%) excede el límite máximo admisible (40%).",
              passed: false,
            },
          ],
        },
      ],
      sourceResults: [],
    };

    fetchMock.mockReturnValueOnce(jsonResponse(mockNoCompatEvaluation));

    render(
      <MemoryRouter initialEntries={["/banco-demo/evaluaciones/eval-100"]}>
        <Routes>
          <Route path="/:tenantSlug/evaluaciones/:id" element={<EvaluationDetail slug="banco-demo" />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("COMPLETADA")).toBeInTheDocument();
      expect(screen.getByText("Ningún producto compatible para este perfil")).toBeInTheDocument();
      expect(
        screen.getByText("Ningún producto compatible para este perfil").compareDocumentPosition(
          screen.getByText("Perfil Financiero Básico"),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        screen.getByText("Ver otros productos evaluados no compatibles (1)"),
      ).toBeInTheDocument();
      // Should not be presented as a failure
      expect(screen.queryByText("NO COMPLETADA")).not.toBeInTheDocument();
      expect(screen.queryByText("FALLIDA")).not.toBeInTheDocument();
    });

    // Expand non-compatible products to view explainable failed reasons
    const toggleBtn = screen.getByText("Ver otros productos evaluados no compatibles (1)");
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(screen.getByText("No compatible")).toBeInTheDocument();
      expect(
        screen.getByText("Relación deuda/ingreso (65.0%) excede el límite máximo admisible (40%)."),
      ).toBeInTheDocument();
    });
  });

  it("CA-12.08: distinguishes multiple compatible products with recommendation priority badges", async () => {
    const mockMultipleCompatEvaluation = {
      ...mockDraftEvaluation,
      status: "COMPLETED",
      completedAt: "2026-10-10T20:30:00.000Z",
      ruleVersion: "1.0.0",
      profile: {
        id: "prof-1",
        averageMonthlyIncome: 12000,
        averageMonthlyExpenses: 4000,
        disposableIncome: 8000,
        totalDebt: 3000,
        activeCredits: 1,
        debtToIncome: 0.1,
        hasRecentArrears: false,
        completeness: 1,
        profileVersion: "1.0.0",
        calculatedAt: "2026-10-10T20:30:00.000Z",
      },
      recommendations: [
        {
          id: "rec-1",
          productId: "prod-1",
          productName: "Microcrédito Emprendedor",
          category: "MICRO_CREDIT",
          outcome: "RECOMMENDED",
          ruleVersion: "1.0.0",
          minAmount: 5000,
          maxAmount: 50000,
          evaluatedAt: "2026-10-10T20:30:00.000Z",
          reasons: [],
        },
        {
          id: "rec-2",
          productId: "prod-2",
          productName: "Crédito Verde",
          category: "GREEN_CREDIT",
          outcome: "RECOMMENDED",
          ruleVersion: "1.0.0",
          minAmount: 10000,
          maxAmount: 80000,
          evaluatedAt: "2026-10-10T20:30:00.000Z",
          reasons: [],
        },
      ],
      sourceResults: [],
    };

    fetchMock.mockReturnValueOnce(jsonResponse(mockMultipleCompatEvaluation));

    render(
      <MemoryRouter initialEntries={["/banco-demo/evaluaciones/eval-100"]}>
        <Routes>
          <Route path="/:tenantSlug/evaluaciones/:id" element={<EvaluationDetail slug="banco-demo" />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Recomendación principal")).toBeInTheDocument();
      expect(screen.getByText("Alternativa compatible")).toBeInTheDocument();
    });
  });

  describe("HU-15 — Procesar Banco y Buró con procedencia y estados comprensibles", () => {
    it("renders multi-source coverage badges and indicator provenance labels (CA-15.03, CA-15.08)", async () => {
      const mockMultiSourceEval = {
        ...mockDraftEvaluation,
        status: "COMPLETED",
        profile: {
          id: "prof-multi",
          averageMonthlyIncome: 8000,
          averageMonthlyExpenses: 3000,
          disposableIncome: 5000,
          totalDebt: 12000,
          activeCredits: 2,
          debtToIncome: 0.15,
          hasRecentArrears: false,
          completeness: 1,
          profileVersion: "1.0.0",
          calculatedAt: "2026-10-10T20:30:00.000Z",
          indicatorProvenance: {
            averageMonthlyIncome: "BANK_MOCK",
            averageMonthlyExpenses: "BANK_MOCK",
            disposableIncome: "BANK_MOCK",
            totalDebt: "CONSOLIDATED",
            activeCredits: "CONSOLIDATED",
            debtToIncome: "CONSOLIDATED",
            hasRecentArrears: "CONSOLIDATED",
          },
        },
        sourceResults: [
          {
            id: "sr-1",
            providerId: "p-bank",
            providerCode: "BANK_MOCK",
            providerName: "Banco Unión Mock",
            status: "SUCCESS",
            attemptCount: 1,
            externalReference: "BM-1",
            errorCode: null,
            requestedAt: "2026-10-10T20:00:00.000Z",
            respondedAt: "2026-10-10T20:01:00.000Z",
          },
          {
            id: "sr-2",
            providerId: "p-bureau",
            providerCode: "BUREAU_MOCK",
            providerName: "Buró de Crédito Mock",
            status: "SUCCESS",
            attemptCount: 1,
            externalReference: "BUR-1",
            errorCode: null,
            requestedAt: "2026-10-10T20:00:00.000Z",
            respondedAt: "2026-10-10T20:01:00.000Z",
          },
        ],
        recommendations: [],
      };

      fetchMock.mockReturnValueOnce(jsonResponse(mockMultiSourceEval));

      render(
        <MemoryRouter initialEntries={["/banco-demo/evaluaciones/eval-100"]}>
          <Routes>
            <Route path="/:tenantSlug/evaluaciones/:id" element={<EvaluationDetail slug="banco-demo" />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText("Perfil Financiero Consolidado")).toBeInTheDocument();
        expect(screen.getByText(/Banco Unión Mock: Disponible/i)).toBeInTheDocument();
        expect(screen.getByText(/Buró de Crédito Mock: Disponible/i)).toBeInTheDocument();
        expect(screen.getAllByText("Consolidado (Banco + Buró)").length).toBeGreaterThan(0);
        expect(screen.getAllByText("Fuente: Banco").length).toBeGreaterThan(0);
      });
    });

    it("renders 'Sin antecedentes en Buró' banner when Buró returns NO_DATA (CA-15.06, CA-15.13)", async () => {
      const mockBureauNoDataEval = {
        ...mockDraftEvaluation,
        status: "COMPLETED",
        profile: {
          id: "prof-nodata",
          averageMonthlyIncome: 5000,
          averageMonthlyExpenses: 2000,
          disposableIncome: 3000,
          totalDebt: 3000,
          activeCredits: 1,
          debtToIncome: 0.06,
          hasRecentArrears: false,
          completeness: 1,
          profileVersion: "1.0.0",
          calculatedAt: "2026-10-10T20:30:00.000Z",
          indicatorProvenance: {
            averageMonthlyIncome: "BANK_MOCK",
            totalDebt: "BANK_MOCK",
            activeCredits: "BANK_MOCK",
          },
        },
        sourceResults: [
          {
            id: "sr-1",
            providerId: "p-bank",
            providerCode: "BANK_MOCK",
            providerName: "Banco Unión Mock",
            status: "SUCCESS",
            attemptCount: 1,
          },
          {
            id: "sr-2",
            providerId: "p-bureau",
            providerCode: "BUREAU_MOCK",
            providerName: "Buró de Crédito Mock",
            status: "NO_DATA",
            attemptCount: 1,
          },
        ],
        recommendations: [],
      };

      fetchMock.mockReturnValueOnce(jsonResponse(mockBureauNoDataEval));

      render(
        <MemoryRouter initialEntries={["/banco-demo/evaluaciones/eval-100"]}>
          <Routes>
            <Route path="/:tenantSlug/evaluaciones/:id" element={<EvaluationDetail slug="banco-demo" />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText(/Sin antecedentes en Buró:/i)).toBeInTheDocument();
        expect(screen.getByText(/Buró de Crédito Mock: Sin antecedentes/i)).toBeInTheDocument();
      });
    });

    it("renders FAILED state with retry button and preserves context (CA-15.07, CA-15.10)", async () => {
      const mockFailedEval = {
        ...mockDraftEvaluation,
        status: "FAILED",
        failureCode: "BUREAU_UNAVAILABLE",
        failureMessage: "Buró de Crédito no está disponible temporalmente.",
        sourceResults: [
          {
            id: "sr-1",
            providerCode: "BANK_MOCK",
            providerName: "Banco Unión Mock",
            status: "SUCCESS",
          },
          {
            id: "sr-2",
            providerCode: "BUREAU_MOCK",
            providerName: "Buró de Crédito Mock",
            status: "UNAVAILABLE",
          },
        ],
      };

      fetchMock.mockReturnValueOnce(jsonResponse(mockFailedEval));

      render(
        <MemoryRouter initialEntries={["/banco-demo/evaluaciones/eval-100"]}>
          <Routes>
            <Route path="/:tenantSlug/evaluaciones/:id" element={<EvaluationDetail slug="banco-demo" />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText("NO COMPLETADA")).toBeInTheDocument();
        expect(screen.getByText("Buró de Crédito no está disponible temporalmente.")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Reintentar evaluación/i })).toBeInTheDocument();
      });
    });
  });

  describe("HU-17 Recomendar productos institucionales a partir del perfil multifuente", () => {
    it("PA-17.01 & CA-17.02 & CA-17.04: recommends institutional company product with explainable reasons", async () => {
      const mockCompanyEval = {
        ...mockDraftEvaluation,
        clientName: "Inversiones Santa Cruz SRL",
        documentType: "NIT",
        documentNumber: "1020304050",
        requestedAmount: 120000,
        purpose: "BUSINESS_INVESTMENT",
        status: "COMPLETED",
        completedAt: "2026-10-11T12:00:00.000Z",
        ruleVersion: "1.0.0",
        profile: {
          id: "prof-comp",
          averageMonthlyIncome: 50000,
          averageMonthlyExpenses: 20000,
          disposableIncome: 30000,
          totalDebt: 75000,
          activeCredits: 2,
          debtToIncome: 0.15,
          hasRecentArrears: false,
          completeness: 1,
          profileVersion: "1.0.0",
          calculatedAt: "2026-10-11T12:00:00.000Z",
        },
        recommendations: [
          {
            id: "rec-comp-1",
            productId: "prod-sme",
            productName: "Línea Corporativa PYME",
            category: "SME_CREDIT",
            outcome: "RECOMMENDED",
            compatibilityStatus: "COMPATIBLE",
            ruleVersion: "1.0.0",
            minAmount: 50000,
            maxAmount: 500000,
            evaluatedAt: "2026-10-11T12:00:00.000Z",
            reasons: [
              {
                code: "RULE_APPLICANT_SCOPE",
                message: "Tipo de solicitante (Empresa) admitido para este producto.",
                passed: true,
                status: "PASSED",
              },
              {
                code: "RULE_AMOUNT_RANGE",
                message: "Monto solicitado dentro del rango permitido (Bs. 50.000 - Bs. 500.000).",
                passed: true,
                status: "PASSED",
              },
              {
                code: "RULE_MAX_DTI",
                message: "Relación deuda/ingreso (15.00%) dentro del límite admisible (máximo 45.00%).",
                passed: true,
                status: "PASSED",
              },
            ],
          },
        ],
        sourceResults: [],
      };

      fetchMock.mockReturnValueOnce(jsonResponse(mockCompanyEval));

      render(
        <MemoryRouter initialEntries={["/banco-demo/evaluaciones/eval-100"]}>
          <Routes>
            <Route path="/:tenantSlug/evaluaciones/:id" element={<EvaluationDetail slug="banco-demo" />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText("Inversiones Santa Cruz SRL")).toBeInTheDocument();
        expect(screen.getByText("Línea Corporativa PYME")).toBeInTheDocument();
        expect(screen.getByText("Compatible")).toBeInTheDocument();
        expect(screen.getByText("Tipo de solicitante (Empresa) admitido para este producto.")).toBeInTheDocument();
        expect(screen.getByText("Monto solicitado dentro del rango permitido (Bs. 50.000 - Bs. 500.000).")).toBeInTheDocument();
        expect(screen.getByText(/Aviso de recomendación:/i)).toBeInTheDocument();
      });
    });

    it("PA-17.02 & CA-17.03: displays non-compatibility when product is restricted to persons", async () => {
      const mockRestrictedEval = {
        ...mockDraftEvaluation,
        clientName: "Empresa Beta SRL",
        documentType: "NIT",
        documentNumber: "9876543210",
        status: "COMPLETED",
        completedAt: "2026-10-11T12:00:00.000Z",
        ruleVersion: "1.0.0",
        profile: {
          id: "prof-comp",
          averageMonthlyIncome: 30000,
          averageMonthlyExpenses: 10000,
          disposableIncome: 20000,
          totalDebt: 5000,
          activeCredits: 1,
          debtToIncome: 0.1,
          hasRecentArrears: false,
          completeness: 1,
          profileVersion: "1.0.0",
          calculatedAt: "2026-10-11T12:00:00.000Z",
        },
        recommendations: [
          {
            id: "rec-pers-only",
            productId: "prod-pers",
            productName: "Microcrédito Personal Exclusivo",
            category: "MICRO_CREDIT",
            outcome: "NOT_COMPATIBLE",
            compatibilityStatus: "INCOMPATIBLE",
            ruleVersion: "1.0.0",
            minAmount: 1000,
            maxAmount: 20000,
            evaluatedAt: "2026-10-11T12:00:00.000Z",
            reasons: [
              {
                code: "RULE_APPLICANT_SCOPE",
                message: "Producto exclusivo para personas naturales. No aplica a empresas.",
                passed: false,
                status: "FAILED",
              },
            ],
          },
        ],
        sourceResults: [],
      };

      fetchMock.mockReturnValueOnce(jsonResponse(mockRestrictedEval));

      render(
        <MemoryRouter initialEntries={["/banco-demo/evaluaciones/eval-100"]}>
          <Routes>
            <Route path="/:tenantSlug/evaluaciones/:id" element={<EvaluationDetail slug="banco-demo" />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText("Ningún producto compatible para este perfil")).toBeInTheDocument();
      });

      const toggleBtn = screen.getByText("Ver otros productos evaluados no compatibles (1)");
      fireEvent.click(toggleBtn);

      await waitFor(() => {
        expect(screen.getByText("Microcrédito Personal Exclusivo")).toBeInTheDocument();
        expect(screen.getByText("Producto exclusivo para personas naturales. No aplica a empresas.")).toBeInTheDocument();
      });
    });

    it("PA-17.03 & PA-17.04 & CA-17.05 & CA-17.13: displays unverified conditions as NOT_EVALUABLE with limitation explanation", async () => {
      const mockPartialDataEval = {
        ...mockDraftEvaluation,
        clientName: "Empresa Gamma SRL",
        documentType: "NIT",
        documentNumber: "5555555555",
        status: "COMPLETED",
        completedAt: "2026-10-11T12:00:00.000Z",
        ruleVersion: "1.0.0",
        profile: {
          id: "prof-partial",
          averageMonthlyIncome: null,
          averageMonthlyExpenses: 5000,
          disposableIncome: null,
          totalDebt: 10000,
          activeCredits: 1,
          debtToIncome: null,
          hasRecentArrears: false,
          completeness: 0.6,
          profileVersion: "1.0.0",
          calculatedAt: "2026-10-11T12:00:00.000Z",
        },
        recommendations: [
          {
            id: "rec-uneval-1",
            productId: "prod-flex",
            productName: "Empresarial Flexible",
            category: "SME_CREDIT",
            outcome: "NOT_EVALUABLE",
            compatibilityStatus: "NOT_EVALUABLE",
            ruleVersion: "1.0.0",
            minAmount: 10000,
            maxAmount: 100000,
            evaluatedAt: "2026-10-11T12:00:00.000Z",
            reasons: [
              {
                code: "RULE_APPLICANT_SCOPE",
                message: "Tipo de solicitante (Empresa) admitido para este producto.",
                passed: true,
                status: "PASSED",
              },
              {
                code: "RULE_MAX_DTI_NOT_EVALUABLE",
                message: "Requiere DTI máximo de 40.00%, pero el indicador de relación deuda/ingreso no estuvo disponible en las fuentes consultadas.",
                passed: false,
                status: "NOT_EVALUABLE",
              },
            ],
          },
        ],
        sourceResults: [],
      };

      fetchMock.mockReturnValueOnce(jsonResponse(mockPartialDataEval));

      render(
        <MemoryRouter initialEntries={["/banco-demo/evaluaciones/eval-100"]}>
          <Routes>
            <Route path="/:tenantSlug/evaluaciones/:id" element={<EvaluationDetail slug="banco-demo" />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText("Empresarial Flexible")).toBeInTheDocument();
        expect(screen.getByText("Condición no comprobada / Información insuficiente")).toBeInTheDocument();
        expect(
          screen.getByText(
            "Requiere DTI máximo de 40.00%, pero el indicador de relación deuda/ingreso no estuvo disponible en las fuentes consultadas.",
          ),
        ).toBeInTheDocument();
        expect(
          screen.getByText(/Estos productos no se descartan como incompatibles porque la información disponible en las fuentes consultadas fue insuficiente/i),
        ).toBeInTheDocument();
      });
    });

    it("PA-17.05 & CA-17.07: completes evaluation cleanly without formal rejection when no product matches", async () => {
      const mockNoMatchEval = {
        ...mockDraftEvaluation,
        clientName: "Comercializadora Delta SRL",
        status: "COMPLETED",
        completedAt: "2026-10-11T12:00:00.000Z",
        ruleVersion: "1.0.0",
        profile: {
          id: "prof-highdebt",
          averageMonthlyIncome: 10000,
          averageMonthlyExpenses: 9000,
          disposableIncome: 1000,
          totalDebt: 80000,
          activeCredits: 3,
          debtToIncome: 0.8,
          hasRecentArrears: true,
          completeness: 1,
          profileVersion: "1.0.0",
          calculatedAt: "2026-10-11T12:00:00.000Z",
        },
        recommendations: [
          {
            id: "rec-incomp",
            productId: "prod-1",
            productName: "Microcrédito",
            category: "MICRO_CREDIT",
            outcome: "NOT_COMPATIBLE",
            compatibilityStatus: "INCOMPATIBLE",
            ruleVersion: "1.0.0",
            minAmount: 1000,
            maxAmount: 20000,
            evaluatedAt: "2026-10-11T12:00:00.000Z",
            reasons: [
              {
                code: "RULE_RECENT_ARREARS",
                message: "El producto requiere historial sin atrasos vigentes.",
                passed: false,
                status: "FAILED",
              },
            ],
          },
        ],
        sourceResults: [],
      };

      fetchMock.mockReturnValueOnce(jsonResponse(mockNoMatchEval));

      render(
        <MemoryRouter initialEntries={["/banco-demo/evaluaciones/eval-100"]}>
          <Routes>
            <Route path="/:tenantSlug/evaluaciones/:id" element={<EvaluationDetail slug="banco-demo" />} />
          </Routes>
        </MemoryRouter>,
      );

      await waitFor(() => {
        expect(screen.getByText("COMPLETADA")).toBeInTheDocument();
        expect(screen.getByText("Ningún producto compatible para este perfil")).toBeInTheDocument();
        expect(
          screen.getByText(/sin registrar un rechazo formal de crédito/i),
        ).toBeInTheDocument();
        expect(screen.queryByText("RECHAZADA")).not.toBeInTheDocument();
        expect(screen.queryByText("FALLIDA")).not.toBeInTheDocument();
      });
    });
  });
});

