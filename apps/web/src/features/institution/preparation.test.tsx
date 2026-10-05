import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstitutionHomePage } from "./InstitutionHomePage";
import type { InstitutionHome } from "./api";

const initial = (): InstitutionHome => ({
  user: { name: "Ana María López" },
  tenant: { name: "Banco X", slug: "banco-x", taxId: "123", type: "BANK" },
  membership: { role: "INSTITUTION_ADMIN", status: "ACTIVE" },
  source: { available: true, enabled: false },
  products: [
    {
      id: "product-1",
      name: "Microcrédito Emprendedor",
      category: "MICRO_CREDIT",
      applicantScope: "PERSON",
      minAmount: "5000",
      maxAmount: "50000",
      purposes: ["WORKING_CAPITAL"],
      selected: false,
    },
  ],
  steps: { institution: false, source: false, products: false },
  completed: 0,
  percentage: 0,
  ready: false,
});

describe("HU-08 preparation interface", () => {
  let state: InstitutionHome;
  const fetchMock = vi.fn();
  beforeEach(() => {
    state = initial();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        if (url.endsWith("/institution")) state.steps.institution = true;
        if (url.endsWith("/source")) {
          state.steps.source = true;
          state.source.enabled = true;
        }
        if (url.endsWith("/products")) {
          state.steps.products = true;
          const ids = JSON.parse(String(options.body)).productIds as string[];
          state.products = state.products.map((product) => ({
            ...product,
            selected: ids.includes(product.id),
          }));
        }
        state.completed = Object.values(state.steps).filter(Boolean).length;
        state.percentage = Math.round((state.completed / 3) * 100);
        state.ready = state.completed === 3;
      }
      return {
        ok: true,
        status: options?.method === "POST" ? 201 : 200,
        json: async () => structuredClone(state),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("walks from 0/3 to 3/3 and retains progress when the page is remounted", async () => {
    const routes = [
      { path: "/:tenantSlug", element: <InstitutionHomePage /> },
      { path: "/:tenantSlug/institucion", element: <InstitutionHomePage step="institution" /> },
      { path: "/:tenantSlug/fuentes-financieras", element: <InstitutionHomePage step="source" /> },
      { path: "/:tenantSlug/productos", element: <InstitutionHomePage step="products" /> },
    ];
    const router = createMemoryRouter(routes, { initialEntries: ["/banco-x"] });
    const view = render(<RouterProvider router={router} />);
    expect(await screen.findByText("0 de 3 pasos completados")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("link", { name: /Revisar información de la institución/ })[0]);
    expect(await screen.findByText("Registrado durante la incorporación.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Confirmar información y continuar/ }));
    expect(await screen.findByText("Fuente bancaria simulada")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Habilitar fuente y continuar/ }));
    expect(await screen.findByText("Microcrédito Emprendedor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar productos y finalizar preparación/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/banco-x"));
    expect(await screen.findByText("3 de 3 pasos completados")).toBeInTheDocument();
    view.unmount();
    render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: ["/banco-x"] })} />);
    expect(await screen.findByText("3 de 3 pasos completados")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/tenants/banco-x/home"),
      expect.anything(),
    );
  });
});
