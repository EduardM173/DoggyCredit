import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstitutionHomePage } from "./InstitutionHomePage";
import type { TenantPlanMeteringDto } from "./api";

const adminUser = { name: "Ana María López" };
const analystUser = { name: "Carlos Analista" };
const tenant = { name: "Banco Solidario", slug: "banco-solidario", taxId: "123456", type: "BANK" };

const mockHomeData = (role: "INSTITUTION_ADMIN" | "ANALYST" = "INSTITUTION_ADMIN") => ({
  user: role === "INSTITUTION_ADMIN" ? adminUser : analystUser,
  tenant,
  membership: { role, status: "ACTIVE" },
  ready: true,
  source: { available: true, enabled: true },
  products: [{ id: "prod-1", name: "Microcrédito Productivo", selected: true, applicantScope: "PERSON" }],
  steps: { institution: true, source: true, products: true },
  completed: 3,
  percentage: 100,
});

const mockEvaluationDetail = {
  id: "eval-123",
  tenantId: "tenant-1",
  clientId: "client-1",
  clientName: "Juan Pérez",
  documentType: "CI",
  documentNumber: "1234567",
  purpose: "WORKING_CAPITAL",
  requestedAmount: 15000,
  status: "COMPLETED",
  ruleVersion: "1.0.0",
  createdAt: "2026-10-20T10:00:00Z",
  profile: {
    averageMonthlyIncome: 5000,
    averageMonthlyExpenses: 2000,
    disposableIncome: 3000,
    totalDebt: 1000,
    activeCredits: 1,
    debtToIncome: 0.2,
    hasRecentArrears: false,
    completeness: 1,
    profileVersion: "1.0.0",
    calculatedAt: "2026-10-20T10:00:00Z",
  },
  recommendations: [],
  sourceResults: [],
};

const mockPlanData: TenantPlanMeteringDto = {
  tenant: { id: "tenant-1", name: "Banco Solidario", slug: "banco-solidario" },
  subscription: {
    id: "sub-1",
    status: "ACTIVE",
    startsAt: "2026-10-01T04:00:00.000Z",
    endsAt: null,
  },
  plan: {
    id: "plan-1",
    name: "Plan Crecimiento",
    code: "GROWTH",
    description: "Plan con cuota mensual",
    price: 150,
    currency: "USD",
    billingPeriod: "MONTHLY",
    requiresPayment: true,
    features: ["Evaluaciones ilimitadas"],
    maxUsers: 5,
  },
  capacity: {
    state: "LIMITADO",
    unit: "evaluaciones",
    limit: 100,
    consumed: 25,
    remaining: 75,
    percentage: 25,
    isExceeded: false,
  },
  cycle: {
    startDate: "2026-10-01",
    endDate: "2026-10-31",
    timezone: "America/La_Paz",
    renewalDate: "2026-11-01",
  },
  scoring: {
    enabled: true,
    type: "RULES_BASED",
    description: "Evaluación paramétrica",
  },
  asOf: "2026-10-20T12:00:00Z",
  permissions: {
    canViewCommercialTerms: true,
    canEvaluate: true,
    role: "INSTITUTION_ADMIN",
  },
  environment: {
    isSimulation: true,
    disclaimer: "Modo simulado",
  },
};

const response = (data: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });

const mountRoute = (initialPath: string) => {
  const router = createMemoryRouter(
    [
      { path: "/:tenantSlug", element: <InstitutionHomePage /> },
      { path: "/:tenantSlug/plan", element: <InstitutionHomePage step="plan" /> },
      { path: "/:tenantSlug/actividad", element: <InstitutionHomePage step="activity" /> },
      { path: "/:tenantSlug/equipo", element: <InstitutionHomePage step="team" /> },
      { path: "/:tenantSlug/evaluaciones/:id", element: <InstitutionHomePage step="evaluation-detail" /> },
    ],
    { initialEntries: [initialPath] },
  );
  render(<RouterProvider router={router} />);
  return router;
};

describe("S4-HF-11 — Corregir recarga y enlaces directos de React", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("Escenario 1: enlace directo a evaluación (/banco-solidario/evaluaciones/eval-123) restaura contexto y caso", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/home")) return response(mockHomeData("ANALYST"));
      if (url.includes("/financial-integrations")) {
        return response({ items: [] });
      }
      if (url.includes("/evaluations/eval-123")) return response(mockEvaluationDetail);
      return response({});
    });

    mountRoute("/banco-solidario/evaluaciones/eval-123");

    // Valida que se recupere la identidad y el caso directamente desde la URL
    await waitFor(() => {
      expect(screen.getByText("Banco Solidario")).toBeInTheDocument();
      expect(screen.getByText("Carlos Analista")).toBeInTheDocument();
      expect(screen.getByText("Juan Pérez")).toBeInTheDocument();
      expect(screen.getByText("1234567")).toBeInTheDocument();
    });
  });

  it("Escenario 2: enlace directo a plan y consumo (/banco-solidario/plan) restaura suscripción y capacidades", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/home")) return response(mockHomeData("INSTITUTION_ADMIN"));
      if (url.includes("/plan-metering")) return response(mockPlanData);
      return response({});
    });

    mountRoute("/banco-solidario/plan");

    await waitFor(() => {
      expect(screen.getByText("Plan Crecimiento")).toBeInTheDocument();
      expect(screen.getByText("Suscripción Activa")).toBeInTheDocument();
    });
  });

  it("Escenario 3: control de permisos sobre enlace directo (/banco-solidario/actividad) según rol", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/home")) return response(mockHomeData("ANALYST"));
      return response({});
    });

    mountRoute("/banco-solidario/actividad");

    await waitFor(() => {
      expect(screen.getByText("Acceso no autorizado")).toBeInTheDocument();
      expect(screen.getByText(/Solo los administradores institucionales tienen permiso/)).toBeInTheDocument();
    });
  });

  it("Escenario 4: enlace directo a administración de equipo (/banco-solidario/equipo) rechaza rol sin privilegios", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/home")) return response(mockHomeData("ANALYST"));
      return response({});
    });

    mountRoute("/banco-solidario/equipo");

    await waitFor(() => {
      expect(screen.getByText("No tienes permiso para administrar la institución.")).toBeInTheDocument();
    });
  });
});
