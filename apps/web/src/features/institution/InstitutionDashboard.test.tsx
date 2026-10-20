import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstitutionDashboard } from "./InstitutionDashboard";
import type { DashboardMetricsDto } from "./api";

const jsonResponse = (data: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  });

describe("HU-20 InstitutionDashboard — Consultar dashboard institucional orientado a tareas y evaluaciones", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const mockAdminDashboardData: DashboardMetricsDto = {
    tenant: { id: "tenant-sol", slug: "banco-sol", name: "Banco Sol" },
    period: {
      key: "last_30_days",
      label: "Últimos 30 días",
      startDate: "2026-09-20T00:00:00.000Z",
      endDate: "2026-10-20T00:00:00.000Z",
      timezone: "America/La_Paz",
    },
    asOf: "2026-10-20T10:00:00.000Z",
    hasEvaluations: true,
    hasPeriodActivity: true,
    attentionRequiredCount: 2,
    pendingAttention: [
      {
        id: "eval-f1",
        applicantName: "Juan Perez",
        status: "FAILED",
        reasonText: "Falla de conectividad al consultar fuente financiera",
        actionableType: "RETRY",
        actionUrl: "/banco-sol/evaluaciones/eval-f1",
        createdAt: "2026-10-18T10:00:00.000Z",
      },
      {
        id: "eval-i1",
        applicantName: "Comercializadora Illimani SRL",
        status: "INCOMPLETE",
        reasonText: "Información tributaria insuficiente para emitir recomendación",
        actionableType: "REVIEW",
        actionUrl: "/banco-sol/evaluaciones/eval-i1",
        createdAt: "2026-10-17T12:00:00.000Z",
      },
    ],
    metrics: {
      totalEvaluations: 15,
      completionRate: 80,
      byStatus: {
        IN_PROGRESS: 1,
        COMPLETED: 12,
        FAILED: 1,
        INCOMPLETE: 1,
      },
      byScope: {
        CONSUMER: 10,
        COMMERCIAL: 5,
      },
      catalogCompatibility: {
        compatibleEvaluations: 9,
        compatibleRate: 75,
        noProductEvaluations: 3,
      },
    },
    readiness: {
      isReady: true,
      pendingSteps: [],
    },
    permissions: {
      canManageTeam: true,
      canManageProducts: true,
      canEvaluate: true,
      canViewEvaluations: true,
    },
  };

  const mockAnalystDashboardData: DashboardMetricsDto = {
    ...mockAdminDashboardData,
    permissions: {
      canManageTeam: false,
      canManageProducts: false,
      canEvaluate: true,
      canViewEvaluations: true,
    },
  };

  it("identifies tenant, user role, recency and actionable pending evaluations (CA-20.01, CA-20.02, CA-20.04)", async () => {
    fetchMock.mockReturnValue(jsonResponse(mockAdminDashboardData));

    render(
      <MemoryRouter>
        <InstitutionDashboard
          slug="banco-sol"
          role="INSTITUTION_ADMIN"
          ready={true}
          userName="Ana Admin"
        />
      </MemoryRouter>
    );

    // Context & Role (CA-20.01)
    await waitFor(() => {
      expect(screen.getByText("Banco Sol")).toBeInTheDocument();
      expect(screen.getByText("Administración Institucional")).toBeInTheDocument();
      expect(screen.getByText("Bienvenido/a, Ana")).toBeInTheDocument();
    });

    // Pending actionable items (CA-20.02, CA-20.04)
    expect(screen.getByText("Asuntos que requieren atención")).toBeInTheDocument();
    expect(screen.getByText("Juan Perez")).toBeInTheDocument();
    expect(screen.getByText("Falla técnica")).toBeInTheDocument();
    expect(screen.getByText("Reintentar evaluación")).toBeInTheDocument();

    expect(screen.getByText("Comercializadora Illimani SRL")).toBeInTheDocument();
    expect(screen.getByText("Datos incompletos")).toBeInTheDocument();
    expect(screen.getByText("Revisar evaluación")).toBeInTheDocument();

    // Clarification that technical failure is not a credit rejection (CA-20.04)
    expect(
      screen.getByText(/Una falla técnica no significa que el crédito fue rechazado/i)
    ).toBeInTheDocument();

    // Admin controls are visible for admin (CA-20.02)
    expect(screen.getByText("Gestionar equipo")).toBeInTheDocument();
    expect(screen.getByText("Catálogo de productos")).toBeInTheDocument();
  });

  it("does not show admin controls (team, products) to Carlos the Analyst (CA-20.02)", async () => {
    fetchMock.mockReturnValue(jsonResponse(mockAnalystDashboardData));

    render(
      <MemoryRouter>
        <InstitutionDashboard
          slug="banco-sol"
          role="ANALYST"
          ready={true}
          userName="Carlos Analista"
        />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Analista de Crédito")).toBeInTheDocument();
    });

    // Analyst should see task-oriented actions
    expect(screen.getByText("Nueva evaluación")).toBeInTheDocument();
    expect(screen.getByText("Ver todas las evaluaciones")).toBeInTheDocument();

    // Analyst should NOT see admin controls (CA-20.02)
    expect(screen.queryByText("Gestionar equipo")).not.toBeInTheDocument();
    expect(screen.queryByText("Catálogo de productos")).not.toBeInTheDocument();
  });

  it("displays empty state when institution has no evaluations yet (CA-20.08)", async () => {
    const brandNewData: DashboardMetricsDto = {
      ...mockAdminDashboardData,
      hasEvaluations: false,
      hasPeriodActivity: false,
      attentionRequiredCount: 0,
      pendingAttention: [],
      metrics: {
        totalEvaluations: 0,
        completionRate: null,
        byStatus: { IN_PROGRESS: 0, COMPLETED: 0, FAILED: 0, INCOMPLETE: 0 },
        byScope: { CONSUMER: 0, COMMERCIAL: 0 },
        catalogCompatibility: { compatibleEvaluations: 0, compatibleRate: null, noProductEvaluations: 0 },
      },
    };

    fetchMock.mockReturnValue(jsonResponse(brandNewData));

    render(
      <MemoryRouter>
        <InstitutionDashboard
          slug="banco-sol"
          role="INSTITUTION_ADMIN"
          ready={true}
          userName="Ana Admin"
        />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Comienza a evaluar en Banco Sol")).toBeInTheDocument();
    });

    expect(screen.getByText("Realizar primera evaluación")).toBeInTheDocument();
    // In all-clear state
    expect(
      screen.getByText(/Al día: No hay evaluaciones con fallas o datos incompletos/i)
    ).toBeInTheDocument();
  });

  it("displays 'Sin movimientos en el período seleccionado' when evaluations exist but period has 0 (CA-20.08)", async () => {
    const noMovementData: DashboardMetricsDto = {
      ...mockAdminDashboardData,
      hasEvaluations: true,
      hasPeriodActivity: false,
      period: {
        key: "today",
        label: "Hoy",
        startDate: "2026-10-20T00:00:00.000Z",
        endDate: "2026-10-20T23:59:59.000Z",
        timezone: "America/La_Paz",
      },
      attentionRequiredCount: 0,
      pendingAttention: [],
    };

    fetchMock.mockReturnValue(jsonResponse(noMovementData));

    render(
      <MemoryRouter>
        <InstitutionDashboard
          slug="banco-sol"
          role="INSTITUTION_ADMIN"
          ready={true}
          userName="Ana Admin"
        />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Sin movimientos en el período seleccionado")).toBeInTheDocument();
    });
  });

  it("handles zero-denominator completion rate as 'No disponible / Datos insuficientes' (CA-20.14)", async () => {
    const zeroDenomData: DashboardMetricsDto = {
      ...mockAdminDashboardData,
      metrics: {
        ...mockAdminDashboardData.metrics,
        completionRate: null,
      },
    };

    fetchMock.mockReturnValue(jsonResponse(zeroDenomData));

    render(
      <MemoryRouter>
        <InstitutionDashboard
          slug="banco-sol"
          role="INSTITUTION_ADMIN"
          ready={true}
          userName="Ana Admin"
        />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("No disponible / Datos insuficientes")).toBeInTheDocument();
    });
  });

  it("updates period and refetches dashboard data when selector changes (CA-20.15)", async () => {
    fetchMock.mockReturnValue(jsonResponse(mockAdminDashboardData));

    render(
      <MemoryRouter>
        <InstitutionDashboard
          slug="banco-sol"
          role="INSTITUTION_ADMIN"
          ready={true}
          userName="Ana Admin"
        />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("Período temporal")).toBeInTheDocument();
    });

    // Change to 'last_7_days'
    fireEvent.change(screen.getByLabelText("Período temporal"), {
      target: { value: "last_7_days" },
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("period=last_7_days"),
        expect.anything()
      );
    });
  });
});
