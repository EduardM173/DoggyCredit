import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstitutionDetailPage } from "./InstitutionDetailPage";
import type { TenantOperationalDetail } from "./api";

const mockDetail: TenantOperationalDetail = {
  institution: {
    tenantId: "tenant-sol-1",
    institutionName: "Banco Solidario",
    slug: "banco-solidario",
    taxId: "1020304050",
    institutionType: "BANK",
    status: "ACTIVE",
    approvedAt: "2026-10-01T10:00:00Z",
  },
  subscription: {
    id: "sub-1",
    status: "ACTIVE",
    startsAt: "2026-10-01T04:00:00Z",
    endsAt: null,
  },
  plan: {
    id: "plan-basic",
    code: "BASIC",
    name: "Plan Básico",
    price: 0,
    currency: "BOB",
    billingPeriod: "MONTHLY",
    evaluationsLimit: 50,
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
    renewalDate: "2026-11-01T04:00:00.000Z",
    timezone: "America/La_Paz",
  },
  membershipsSummary: {
    totalUsers: 2,
    adminsCount: 1,
    analystsCount: 1,
    members: [
      {
        id: "mem-1",
        fullName: "Ana Lopez",
        email: "ana@bancosol.bo",
        role: "INSTITUTION_ADMIN",
        status: "ACTIVE",
        isInitialAdmin: true,
        createdAt: "2026-10-01T10:00:00Z",
      },
      {
        id: "mem-2",
        fullName: "Carlos Quispe",
        email: "carlos@bancosol.bo",
        role: "ANALYST",
        status: "ACTIVE",
        isInitialAdmin: false,
        createdAt: "2026-10-05T12:00:00Z",
      },
    ],
  },
  integrations: [
    {
      providerCode: "BANK_MOCK",
      providerName: "Banco Central Mock",
      enabled: true,
      globallyEnabled: true,
      healthState: "OPERATIVO_OBSERVADO",
      healthLabel: "Operativo (observado)",
      lastSignalAt: "2026-10-20T12:00:00Z",
      hasIssue: false,
    },
    {
      providerCode: "BUREAU_MOCK",
      providerName: "Buró de Crédito Mock",
      enabled: true,
      globallyEnabled: true,
      healthState: "DEGRADADO_OBSERVADO",
      healthLabel: "Degradado (observado)",
      lastSignalAt: "2026-10-20T12:00:00Z",
      hasIssue: true,
    },
  ],
  privacyNotice:
    "Acceso operativo restringido. Conforme a las políticas de secreto bancario y privacidad (RF-05, CA-22.05), la información de solicitantes, expedientes, créditos y consultas individuales permanece inaccesible.",
};

const response = (data: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });

describe("HU-22 InstitutionDetailPage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(() => response(mockDetail));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  const mount = (id = "tenant-sol-1") => {
    const router = createMemoryRouter(
      [
        { path: "/admin/instituciones/:id", element: <InstitutionDetailPage /> },
        { path: "/admin/instituciones", element: <p>Lista de instituciones</p> },
        { path: "/admin/integraciones/:code", element: <p>Diagnóstico de integración</p> },
        { path: "/admin/login", element: <p>Login required</p> },
      ],
      { initialEntries: [`/admin/instituciones/${id}`] },
    );
    render(<RouterProvider router={router} />);
    return router;
  };

  it("renders tenant operational summary with plan and RF-03 quota consumption", async () => {
    mount();
    await screen.findByRole("heading", { level: 1, name: "Banco Solidario" });

    expect(screen.getByText("1020304050")).toBeInTheDocument();
    expect(screen.getAllByText("Plan Básico").length).toBeGreaterThan(0);
    expect(screen.getByText("15 / 50")).toBeInTheDocument();
    expect(screen.getByText("Restan 35 evaluaciones en el ciclo mensual actual.")).toBeInTheDocument();

    const progress = screen.getByRole("progressbar");
    expect(progress).toHaveAttribute("aria-valuenow", "15");
    expect(progress).toHaveAttribute("aria-valuemax", "50");
  });

  it("flags degraded integration with direct contextual link to HU-23 (CA-22.06)", async () => {
    mount();
    await screen.findByRole("heading", { level: 1, name: "Banco Solidario" });

    // Warning alert
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/Degradación observada en integraciones:.*Buró de Crédito Mock/);

    // Contextual button leading to HU-23
    const link = screen.getByRole("link", { name: "Ver problema (HU-23)" });
    expect(link).toHaveAttribute("href", "/admin/integraciones/BUREAU_MOCK");
  });

  it("displays memberships without exposing passwords or tokens (CA-22.10)", async () => {
    mount();
    await screen.findByRole("heading", { level: 1, name: "Banco Solidario" });

    expect(screen.getByText("Ana Lopez")).toBeInTheDocument();
    expect(screen.getByText("ana@bancosol.bo")).toBeInTheDocument();
    expect(screen.getByText("Carlos Quispe")).toBeInTheDocument();
    expect(screen.getByText("carlos@bancosol.bo")).toBeInTheDocument();

    // Security check: no token or secret references
    expect(screen.queryByText(/token/i)).not.toHaveClass("token");
    expect(screen.queryByText(/hash/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Las credenciales de acceso y tokens de invitación no son visibles/),
    ).toBeInTheDocument();
  });

  it("guarantees privacy policy: no applicant financial PII rendered (CA-22.05, CA-22.11)", async () => {
    mount();
    await screen.findByRole("heading", { level: 1, name: "Banco Solidario" });

    // Explicit privacy guarantee banner
    expect(
      screen.getByRole("region", { name: "Garantía de privacidad operativa" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Esta vista supervisa exclusivamente capacidades, consumo agregado e infraestructura/),
    ).toBeInTheDocument();

    // Check absence of applicant PII keywords
    expect(screen.queryByText(/expediente individual/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ingresos mensuales/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/deuda bancaria/i)).not.toBeInTheDocument();
  });

  it("handles error state and allows retry", async () => {
    fetchMock.mockImplementationOnce(() => response({}, 500));
    mount();

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByRole("heading", { level: 1, name: "Banco Solidario" });
  });
});
