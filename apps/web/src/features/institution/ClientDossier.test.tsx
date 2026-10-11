import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientDossier } from "./ClientDossier";

const jsonResponse = (data: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  });

describe("HU-19 ClientDossier — Consultar expediente y evaluaciones del solicitante", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const mockDossierPerson = {
    client: {
      id: "client-pers-1",
      tenantId: "tenant-demo",
      type: "PERSON",
      documentType: "CI",
      documentNumber: "4567890",
      name: "Juan Perez Mamani",
      economicActivity: "Comercio minorista de abarrotes",
      metadata: { phone: "70012345" },
      createdAt: "2026-09-15T10:00:00.000Z",
      updatedAt: "2026-09-15T10:00:00.000Z",
    },
    evaluations: [
      {
        id: "eval-001",
        tenantId: "tenant-demo",
        clientId: "client-pers-1",
        clientName: "Juan Perez Mamani",
        documentType: "CI",
        documentNumber: "4567890",
        purpose: "WORKING_CAPITAL",
        requestedAmount: 12000,
        status: "COMPLETED",
        consentGivenAt: "2026-09-15T10:30:00.000Z",
        ruleVersion: "1.0.0",
        applicantSnapshot: {
          clientName: "Juan Perez Mamani",
          documentNumber: "4567890",
          economicActivity: "Comercio minorista",
        },
        createdAt: "2026-09-15T10:30:00.000Z",
      },
      {
        id: "eval-002",
        tenantId: "tenant-demo",
        clientId: "client-pers-1",
        clientName: "Juan Perez Mamani",
        documentType: "CI",
        documentNumber: "4567890",
        purpose: "EQUIPMENT",
        requestedAmount: 25000,
        status: "INCOMPLETE",
        consentGivenAt: "2026-10-01T14:00:00.000Z",
        ruleVersion: "1.0.0",
        applicantSnapshot: {
          clientName: "Juan Perez Mamani",
          documentNumber: "4567890",
          economicActivity: "Comercio minorista de abarrotes",
        },
        createdAt: "2026-10-01T14:00:00.000Z",
      },
    ],
    latestFinancialProfile: {
      id: "fp-001",
      averageMonthlyIncome: 8500,
      averageMonthlyExpenses: 3200,
      disposableIncome: 5300,
      totalDebt: 1500,
      activeCredits: 1,
      debtToIncome: 0.18,
      hasRecentArrears: false,
      completeness: 1,
      profileVersion: "1.0.0",
      calculatedAt: "2026-09-15T10:31:00.000Z",
      indicatorProvenance: {
        averageMonthlyIncome: "BANK_MOCK",
        averageMonthlyExpenses: "BANK_MOCK",
        disposableIncome: "CONSOLIDATED",
        totalDebt: "BUREAU_MOCK",
        activeCredits: "BUREAU_MOCK",
        debtToIncome: "CONSOLIDATED",
        hasRecentArrears: "BUREAU_MOCK",
      },
    },
  };

  const renderDossier = (slug = "banco-sol", clientId = "client-pers-1", ready = true) => {
    return render(
      <MemoryRouter initialEntries={[`/${slug}/clientes/${clientId}`]}>
        <Routes>
          <Route path="/:tenantSlug/clientes/:clientId" element={<ClientDossier slug={slug} ready={ready} />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  it("PA-19.01: muestra el expediente y las evaluaciones asociadas del solicitante", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(mockDossierPerson));

    renderDossier();

    expect(screen.getByText(/Cargando expediente/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Juan Perez Mamani/i })).toBeInTheDocument();
    });

    // Check applicant current declared information
    expect(screen.getByText(/EXPEDIENTE DE PERSONA NATURAL/i)).toBeInTheDocument();
    expect(screen.getByText("4567890")).toBeInTheDocument();
    expect(screen.getByText("Comercio minorista de abarrotes")).toBeInTheDocument();

    // Check associated evaluations table
    expect(screen.getByText("Evaluaciones crediticias vinculadas (2)")).toBeInTheDocument();
    expect(screen.getByText(/12\.000/)).toBeInTheDocument();
    expect(screen.getByText(/25\.000/)).toBeInTheDocument();
    expect(screen.getByText("Capital de trabajo")).toBeInTheDocument();
    expect(screen.getByText("Maquinaria y equipamiento")).toBeInTheDocument();

    // Check action links for historical results
    const detailLinks = screen.getAllByRole("link", { name: /Ver resultado|Ver detalle/i });
    expect(detailLinks).toHaveLength(2);
    expect(detailLinks[0]).toHaveAttribute("href", "/banco-sol/evaluaciones/eval-001");
    expect(detailLinks[1]).toHaveAttribute("href", "/banco-sol/evaluaciones/eval-002");
  });

  it("PA-19.02: distingue datos vigentes de los snapshots inmutables sin recalcular evaluaciones pasadas", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(mockDossierPerson));

    renderDossier();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Juan Perez Mamani/i })).toBeInTheDocument();
    });

    // Information banner explaining snapshot immutability
    expect(
      screen.getByText(/inmutabilidad de evaluaciones crediticias pasadas/i),
    ).toBeInTheDocument();

    // Verification of snapshot labels in evaluations
    expect(screen.getByText(/snapshot histórico congelado/i)).toBeInTheDocument();
  });

  it("PA-19.03: los indicadores financieros son de solo lectura y presentan procedencia sin inputs editables", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(mockDossierPerson));

    const { container } = renderDossier();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Juan Perez Mamani/i })).toBeInTheDocument();
    });

    // Verify indicators are present
    expect(screen.getByText("Antecedentes e indicadores de fuentes financieras")).toBeInTheDocument();
    expect(screen.getByText(/8\.500/)).toBeInTheDocument();
    expect(screen.getByText(/3\.200/)).toBeInTheDocument();
    expect(screen.getByText(/5\.300/)).toBeInTheDocument();
    expect(screen.getByText(/1\.500/)).toBeInTheDocument();
    expect(screen.getByText(/18\.00%/)).toBeInTheDocument();
    expect(screen.getByText("Sin mora registrada")).toBeInTheDocument();

    // Check provenance labels
    expect(screen.getAllByText(/Banco/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Buró/i).length).toBeGreaterThan(0);

    // Verify STRICTLY NO editable form inputs exist for financial indicators or client data
    const editableInputs = container.querySelectorAll("input:not([type='hidden']), textarea, select");
    expect(editableInputs).toHaveLength(0);
  });

  it("CA-19.06: botón [Nueva evaluación] está visible cuando la institución está lista y apunta al asistente", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(mockDossierPerson));

    renderDossier("banco-sol", "client-pers-1", true);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /Juan Perez Mamani/i })).toBeInTheDocument();
    });

    const newEvalBtn = screen.getAllByRole("link", { name: /nueva evaluación/i })[0];
    expect(newEvalBtn).toBeInTheDocument();
    expect(newEvalBtn).toHaveAttribute("href", "/banco-sol/evaluaciones/nueva");
  });

  it("PA-19.04 & CA-19.08: maneja correctamente el caso donde el solicitante no existe o pertenece a otro tenant (404)", async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse(
        {
          statusCode: 404,
          message: "El solicitante solicitado no existe o no pertenece a tu institución.",
        },
        404,
      ),
    );

    renderDossier("banco-sol", "other-tenant-client", true);

    await waitFor(() => {
      expect(
        screen.getByText(/El solicitante solicitado no existe o no pertenece a tu institución/i),
      ).toBeInTheDocument();
    });

    expect(screen.getByRole("link", { name: /Volver a la lista de evaluaciones/i })).toBeInTheDocument();
  });
});
