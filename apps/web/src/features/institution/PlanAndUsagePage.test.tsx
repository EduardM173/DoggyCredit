import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlanAndUsagePage } from "./PlanAndUsagePage";
import type { TenantPlanMeteringDto } from "./api";

const jsonResponse = (data: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  });

describe("HU-21 PlanAndUsagePage — Consultar plan contratado, capacidades y consumo institucional", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const mockBasicPlanData: TenantPlanMeteringDto = {
    tenant: { id: "tenant-sol", name: "Banco Sol", slug: "banco-sol" },
    subscription: {
      id: "sub-1",
      status: "ACTIVE",
      startsAt: "2026-10-01T04:00:00.000Z",
      endsAt: null,
    },
    plan: {
      id: "plan-basic-1",
      code: "BASIC",
      name: "Plan Básico",
      description: "Para cooperativas y financieras emergentes",
      price: 0,
      currency: "BOB",
      billingPeriod: "MONTHLY",
      requiresPayment: false,
      features: ["Banco Mock", "Evaluaciones guiadas"],
      maxUsers: 3,
    },
    capacity: {
      state: "LIMITADO",
      unit: "evaluaciones",
      limit: 50,
      consumed: 15,
      remaining: 35,
      percentage: 30,
      isExceeded: false,
    },
    cycle: {
      startDate: "2026-10-01T04:00:00.000Z",
      endDate: "2026-11-01T04:00:00.000Z",
      timezone: "America/La_Paz",
      renewalDate: "2026-11-01T04:00:00.000Z",
    },
    scoring: {
      enabled: true,
      type: "RULES_BASED",
      description: "Evaluación de idoneidad y capacidad de pago basada en reglas financieras y catálogo institucional (no scoring predictivo).",
    },
    asOf: "2026-10-20T10:00:00.000Z",
    permissions: {
      canViewCommercialTerms: true,
      canEvaluate: true,
      role: "INSTITUTION_ADMIN",
    },
    environment: {
      isSimulation: true,
      disclaimer: "DoggyCredit opera en un entorno simulado de pagos (DoggyPay). No se efectúan cobros reales ni existen recargos ocultos por uso de plataforma.",
    },
  };

  it("displays real usage, limit, remaining quota and commercial terms for Admin (CA-21.01, CA-21.02, CA-21.03)", async () => {
    fetchMock.mockReturnValue(jsonResponse(mockBasicPlanData));

    render(
      <MemoryRouter>
        <PlanAndUsagePage
          slug="banco-sol"
          role="INSTITUTION_ADMIN"
          tenantName="Banco Sol"
        />
      </MemoryRouter>
    );

    // Header & Subscription status (CA-21.01)
    await waitFor(() => {
      expect(screen.getByText("Plan y consumo de Banco Sol")).toBeInTheDocument();
      expect(screen.getByText("Suscripción Activa")).toBeInTheDocument();
      expect(screen.getByText("Administración Institucional")).toBeInTheDocument();
    });

    // Capacity & Limit (CA-21.02, CA-21.03)
    expect(screen.getByText("LIMITADO")).toBeInTheDocument();
    expect(screen.getByText("15")).toBeInTheDocument();
    expect(screen.getByText(/de 50 evaluaciones consumidas/i)).toBeInTheDocument();
    expect(screen.getByText("35")).toBeInTheDocument();
    expect(screen.getByText("30%")).toBeInTheDocument();

    // Plan & Commercial terms for Admin (CA-21.05)
    expect(screen.getByText("Plan Básico")).toBeInTheDocument();
    expect(screen.getByText("Gratuito")).toBeInTheDocument();
    expect(screen.getByText("Banco Mock")).toBeInTheDocument();

    // Simulation & Scoring disclaimers (CA-21.06, CA-21.10)
    expect(screen.getByText(/no scoring predictivo/i)).toBeInTheDocument();
    expect(screen.getByText(/entorno simulado de pagos/i)).toBeInTheDocument();
  });

  it("displays unlimited capacity for Enterprise plan without finite numbers (CA-21.02, CA-21.11)", async () => {
    const mockEnterpriseData: TenantPlanMeteringDto = {
      ...mockBasicPlanData,
      plan: {
        ...mockBasicPlanData.plan!,
        code: "ENTERPRISE",
        name: "Plan Empresarial",
        price: 799,
      },
      capacity: {
        state: "ILIMITADO",
        unit: "evaluaciones",
        limit: null,
        consumed: 120,
        remaining: null,
        percentage: null,
        isExceeded: false,
      },
    };

    fetchMock.mockReturnValue(jsonResponse(mockEnterpriseData));

    render(
      <MemoryRouter>
        <PlanAndUsagePage
          slug="banco-sol"
          role="INSTITUTION_ADMIN"
          tenantName="Banco Sol"
        />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("ILIMITADO")).toBeInTheDocument();
    });

    expect(screen.getByText(/Sin límite mensual/i)).toBeInTheDocument();
    expect(screen.getByText("Evaluaciones Ilimitadas garantizadas por contrato")).toBeInTheDocument();
    expect(screen.queryByText(/de 50 evaluaciones/i)).not.toBeInTheDocument();
  });

  it("displays quota exceeded banner and role-specific guidance for Analyst Carlos (CA-21.04, CA-21.05)", async () => {
    const mockExceededData: TenantPlanMeteringDto = {
      ...mockBasicPlanData,
      capacity: {
        ...mockBasicPlanData.capacity,
        consumed: 50,
        remaining: 0,
        percentage: 100,
        isExceeded: true,
      },
      permissions: {
        canViewCommercialTerms: false,
        canEvaluate: false,
        role: "ANALYST",
      },
    };

    fetchMock.mockReturnValue(jsonResponse(mockExceededData));

    render(
      <MemoryRouter>
        <PlanAndUsagePage
          slug="banco-sol"
          role="ANALYST"
          tenantName="Banco Sol"
        />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Límite de evaluaciones alcanzado en el ciclo actual")).toBeInTheDocument();
    });

    // Analyst role guidance (CA-21.05)
    expect(screen.getByText("Analista de Crédito")).toBeInTheDocument();
    expect(screen.getByText(/contacta a tu administrador institucional/i)).toBeInTheDocument();

    // Analyst does not see commercial terms/prices (CA-21.05)
    expect(screen.queryByText("Precio acordado:")).not.toBeInTheDocument();
  });

  it("handles consultation failure without showing 0 as consumed (CA-21.07)", async () => {
    fetchMock.mockReturnValue(
      Promise.resolve({
        ok: false,
        status: 500,
        json: async () => ({ message: "Error interno del servidor al consultar cuota" }),
      })
    );

    render(
      <MemoryRouter>
        <PlanAndUsagePage
          slug="banco-sol"
          role="INSTITUTION_ADMIN"
          tenantName="Banco Sol"
        />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("No se pudo consultar el plan y consumo")).toBeInTheDocument();
    });

    expect(screen.getByText("Reintentar consulta")).toBeInTheDocument();
    // Must NOT default to 0 consumed
    expect(screen.queryByText("0 de 50 evaluaciones")).not.toBeInTheDocument();
  });

  it("displays NO_CONFIGURADO state when no subscription exists (CA-21.02, CA-21.11)", async () => {
    const mockUnconfiguredData: TenantPlanMeteringDto = {
      ...mockBasicPlanData,
      subscription: {
        id: null,
        status: "NO_SUBSCRIPTION",
        startsAt: null,
        endsAt: null,
      },
      plan: null,
      capacity: {
        state: "NO_CONFIGURADO",
        unit: "evaluaciones",
        limit: null,
        consumed: 0,
        remaining: null,
        percentage: null,
        isExceeded: false,
      },
      permissions: {
        canViewCommercialTerms: true,
        canEvaluate: false,
        role: "INSTITUTION_ADMIN",
      },
    };

    fetchMock.mockReturnValue(jsonResponse(mockUnconfiguredData));

    render(
      <MemoryRouter>
        <PlanAndUsagePage
          slug="banco-sol"
          role="INSTITUTION_ADMIN"
          tenantName="Banco Sol"
        />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("NO_CONFIGURADO")).toBeInTheDocument();
    });

    expect(screen.getByText(/Sin Suscripción Activa/i)).toBeInTheDocument();
    expect(screen.getByText(/No se autoriza procesamiento por omisión/i)).toBeInTheDocument();
  });
});
