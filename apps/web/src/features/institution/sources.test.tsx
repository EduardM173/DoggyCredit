import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstitutionHomePage } from "./InstitutionHomePage";
import type { InstitutionHome } from "./api";

const initialWithSources = (): InstitutionHome => ({
  user: { name: "Ana María López" },
  tenant: { name: "Banco X", slug: "banco-x", taxId: "1234567890", type: "BANK" },
  membership: { role: "INSTITUTION_ADMIN", status: "ACTIVE" },
  source: { available: true, enabled: true },
  sources: [
    {
      code: "BANK_MOCK",
      name: "Fuente bancaria simulada",
      kind: "BANK",
      description: "Proporciona información financiera simulada necesaria para las evaluaciones.",
      purpose: "Construcción del perfil financiero básico a partir de cuentas, balances y flujos de efectivo.",
      coverage: "Personas y microempresas con cuentas bancarias registradas.",
      available: true,
      enabled: true,
      healthStatus: "ACTIVE",
    },
    {
      code: "BUREAU_MOCK",
      name: "Buró crediticio simulado",
      kind: "CREDIT_BUREAU",
      description: "Aporta historial crediticio consolidado, deuda global en el sistema financiero y comportamiento de mora histórico.",
      purpose: "Evaluación complementaria de riesgo crediticio, antecedentes en el sistema y morosidad.",
      coverage: "Cobertura orientada a solicitantes particulares y personas naturales.",
      available: true,
      enabled: false,
      healthStatus: "ACTIVE",
    },
  ],
  products: [
    {
      id: "product-1",
      name: "Microcrédito Emprendedor",
      category: "MICRO_CREDIT",
      applicantScope: "PERSON",
      minAmount: "5000",
      maxAmount: "50000",
      purposes: ["WORKING_CAPITAL"],
      selected: true,
    },
  ],
  steps: { institution: true, source: true, products: true },
  completed: 3,
  percentage: 100,
  ready: true,
});

describe("HU-13 multi-source institutional management", () => {
  let state: InstitutionHome;
  const fetchMock = vi.fn();

  beforeEach(() => {
    state = initialWithSources();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        if (url.includes("/source/bureau")) {
          const body = JSON.parse(String(options.body ?? "{}"));
          const bureau = state.sources?.find((s) => s.code === "BUREAU_MOCK");
          if (bureau) {
            bureau.enabled = body.enabled ?? true;
          }
        }
      }
      return {
        ok: true,
        status: options?.method === "POST" ? 200 : 200,
        json: async () => structuredClone(state),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("displays both sources distinguishing enablement, health and coverage (CA-13.01, CA-13.11)", async () => {
    const routes = [
      { path: "/:tenantSlug", element: <InstitutionHomePage /> },
      { path: "/:tenantSlug/fuentes-financieras", element: <InstitutionHomePage step="source" /> },
    ];
    const router = createMemoryRouter(routes, { initialEntries: ["/banco-x/fuentes-financieras"] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText("Fuente bancaria simulada")).toBeInTheDocument();
    expect(await screen.findByText("Buró crediticio simulado")).toBeInTheDocument();

    // Check institutional enablement badges
    expect(screen.getByText("Habilitada para la institución")).toBeInTheDocument();
    expect(screen.getByText("No habilitada")).toBeInTheDocument();

    // Check technical health badges (CA-13.01 / CA-13.09)
    const healthBadges = screen.getAllByText("Salud técnica: Operativa");
    expect(healthBadges.length).toBe(2);

    // Check coverage limits (CA-13.11)
    expect(
      screen.getByText(/Cobertura orientada a solicitantes particulares y personas naturales/i),
    ).toBeInTheDocument();

    // Check explanation of zero technical credentials required (CA-13.03)
    expect(
      screen.getByText(/No necesitas introducir URLs, claves de API, secretos ni configurar timeouts/i),
    ).toBeInTheDocument();
  });

  it("allows Ana to enable Bureau Mock without credentials and persists on reload (PA-13.01, CA-13.02, CA-13.03)", async () => {
    const routes = [
      { path: "/:tenantSlug", element: <InstitutionHomePage /> },
      { path: "/:tenantSlug/fuentes-financieras", element: <InstitutionHomePage step="source" /> },
    ];
    const router = createMemoryRouter(routes, { initialEntries: ["/banco-x/fuentes-financieras"] });
    const view = render(<RouterProvider router={router} />);

    const enableButton = await screen.findByRole("button", { name: "Habilitar Buró Mock" });
    fireEvent.click(enableButton);

    // After enabling, it displays as enabled
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Deshabilitar Buró Mock" })).toBeInTheDocument();
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/tenants/banco-x/source/bureau"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ enabled: true }),
      }),
    );

    // Remounting page reflects persistent state
    view.unmount();
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/banco-x/fuentes-financieras"] })} />);
    expect(await screen.findByRole("button", { name: "Deshabilitar Buró Mock" })).toBeInTheDocument();
  });

  it("handles unavailable Bureau Mock by displaying restrictions and preventing enablement (PA-13.02, CA-13.05)", async () => {
    state.sources = state.sources?.map((s) =>
      s.code === "BUREAU_MOCK"
        ? { ...s, available: false, healthStatus: "INACTIVE" }
        : s,
    );

    const routes = [
      { path: "/:tenantSlug", element: <InstitutionHomePage /> },
      { path: "/:tenantSlug/fuentes-financieras", element: <InstitutionHomePage step="source" /> },
    ];
    const router = createMemoryRouter(routes, { initialEntries: ["/banco-x/fuentes-financieras"] });
    render(<RouterProvider router={router} />);

    expect(await screen.findByText("Buró crediticio simulado")).toBeInTheDocument();
    expect(screen.getByText("Salud técnica: No disponible")).toBeInTheDocument();
    expect(
      screen.getByText(/Esta fuente no se encuentra disponible actualmente en la plataforma o para tu plan/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Habilitar Buró Mock" })).not.toBeInTheDocument();
  });

  it("supports independent navigation without wizard lock (PA-13.04, CA-13.10)", async () => {
    const routes = [
      { path: "/:tenantSlug", element: <InstitutionHomePage /> },
      { path: "/:tenantSlug/fuentes-financieras", element: <InstitutionHomePage step="source" /> },
      { path: "/:tenantSlug/productos", element: <InstitutionHomePage step="products" /> },
    ];
    const router = createMemoryRouter(routes, { initialEntries: ["/banco-x/fuentes-financieras"] });
    render(<RouterProvider router={router} />);

    // Direct link to Productos is available
    const toProductsLink = await screen.findByRole("link", { name: "Ir a productos" });
    fireEvent.click(toProductsLink);
    await waitFor(() => expect(router.state.location.pathname).toBe("/banco-x/productos"));
  });
});
