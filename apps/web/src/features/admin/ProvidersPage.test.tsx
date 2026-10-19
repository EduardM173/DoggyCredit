import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminLayout } from "./AdminLayout";
import { ProvidersPage } from "./ProvidersPage";
import type { ProviderAdminView } from "./api";

const provider = (over: Partial<ProviderAdminView> = {}): ProviderAdminView => ({
  code: "BANK_MOCK",
  name: "Fuente bancaria simulada",
  kind: "BANK",
  description: "Cuentas y créditos simulados.",
  registered: true,
  coverage: { subjectTypes: ["PERSON", "COMPANY"] },
  global: { enabled: true, changedAt: null },
  health: { status: "ACTIVE" },
  tenants: { enabled: 2 },
  acceptsNewQueries: true,
  simulationScenarios: [{ status: "NO_DATA", documentEnding: "000", description: "Sin antecedentes." }],
  ...over,
});
const bureau = provider({
  code: "BUREAU_MOCK",
  name: "Buró crediticio simulado",
  kind: "CREDIT_BUREAU",
  coverage: { subjectTypes: ["PERSON"] },
  health: { status: "DEGRADED" },
  tenants: { enabled: 1 },
  acceptsNewQueries: false,
});
const session = (platformRole: string) => ({
  user: { id: "u1", fullName: "Admin Plataforma", email: "admin@example.test", platformRole },
  expiresAt: "2027-01-01T00:00:00Z",
});
const response = (data: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });

describe("HU-30 proveedores simulados", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  const mount = (path = "/admin/proveedores", role = "PLATFORM_ADMIN") => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/admin/auth/session")) return response(session(role));
      if (url.endsWith("/admin/platform/providers") && !init?.method) return response([provider(), bureau]);
      if (url.includes("/global-status"))
        return response({
          provider: provider({
            global: { enabled: false, changedAt: "2026-10-18T12:00:00Z" },
            acceptsNewQueries: false,
          }),
          changed: true,
        });
      return response({}, 404);
    });
    const router = createMemoryRouter(
      [
        { path: "/admin/login", element: <p>Login</p> },
        {
          path: "/admin",
          element: <AdminLayout />,
          children: [
            { path: "proveedores", element: <ProvidersPage /> },
            { path: "solicitudes", element: <p>Solicitudes operador</p> },
          ],
        },
      ],
      { initialEntries: [path] },
    );
    render(<RouterProvider router={router} />);
    return router;
  };

  it("muestra por separado habilitación global, salud, instituciones y cobertura", async () => {
    mount();
    const bank = (await screen.findByRole("heading", { name: "Fuente bancaria simulada" })).closest(
      "section",
    )!;
    expect(within(bank).getByText("Habilitado")).toBeInTheDocument();
    expect(within(bank).getByText("Sin incidencias observadas")).toBeInTheDocument();
    expect(within(bank).getByText("Personas y Empresas (NIT)")).toBeInTheDocument();
    const buro = screen.getByRole("heading", { name: "Buró crediticio simulado" }).closest("section")!;
    // Habilitado globalmente pero degradado: dos hechos distintos, no se confunden.
    expect(within(buro).getByText("Habilitado")).toBeInTheDocument();
    expect(within(buro).getByText("Degradado")).toBeInTheDocument();
    expect(within(buro).getByText("No se aceptan")).toBeInTheDocument();
  });

  it("pide confirmación y envía solo enabled y motivo; no ofrece campos técnicos", async () => {
    mount();
    const bank = (await screen.findByRole("heading", { name: "Fuente bancaria simulada" })).closest(
      "section",
    )!;
    expect(screen.queryByLabelText(/url|clave|token|timeout/i)).not.toBeInTheDocument();
    fireEvent.click(within(bank).getByRole("button", { name: "Deshabilitar globalmente" }));
    expect(within(bank).getByText(/conservan sus resultados/)).toBeInTheDocument();
    fireEvent.change(within(bank).getByLabelText("Motivo (opcional)"), {
      target: { value: "Mantenimiento" },
    });
    fireEvent.click(within(bank).getByRole("button", { name: "Confirmar deshabilitación" }));
    await waitFor(() => expect(within(bank).getByText("Deshabilitado")).toBeInTheDocument());
    const call = fetchMock.mock.calls.find(([url]) => String(url).includes("/global-status"))!;
    expect(call[0]).toContain("/admin/platform/providers/BANK_MOCK/global-status");
    expect(JSON.parse(call[1].body)).toEqual({ enabled: false, reason: "Mantenimiento" });
    expect(call[1].headers["X-DoggyCredit-Admin"]).toBe("1");
    expect(screen.getByRole("status")).toHaveTextContent("habilitación global desactivada");
  });

  it("cancelar no envía ningún cambio", async () => {
    mount();
    const bank = (await screen.findByRole("heading", { name: "Fuente bancaria simulada" })).closest(
      "section",
    )!;
    fireEvent.click(within(bank).getByRole("button", { name: "Deshabilitar globalmente" }));
    fireEvent.click(within(bank).getByRole("button", { name: "Cancelar" }));
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/global-status"))).toBe(false);
  });

  it("muestra el error si el servidor rechaza el cambio (403)", async () => {
    mount();
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/admin/auth/session")) return response(session("PLATFORM_ADMIN"));
      if (url.includes("/global-status")) return response({}, 403);
      return response([provider(), bureau]);
    });
    const bank = (await screen.findByRole("heading", { name: "Fuente bancaria simulada" })).closest(
      "section",
    )!;
    fireEvent.click(within(bank).getByRole("button", { name: "Deshabilitar globalmente" }));
    fireEvent.click(within(bank).getByRole("button", { name: "Confirmar deshabilitación" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes autorización");
  });

  it("PLATFORM_ADMIN solo ve Proveedores y es llevado ahí desde pantallas de operador", async () => {
    const router = mount("/admin/solicitudes", "PLATFORM_ADMIN");
    await screen.findByRole("heading", { name: "Proveedores simulados" });
    expect(router.state.location.pathname).toBe("/admin/proveedores");
    const nav = screen.getByRole("navigation", { name: "Administración" });
    expect(within(nav).getByText("Proveedores")).toBeInTheDocument();
    expect(within(nav).queryByText("Solicitudes")).not.toBeInTheDocument();
    expect(screen.getByText("Administrador de plataforma")).toBeInTheDocument();
  });

  it("OPERATOR conserva su navegación y no ve Proveedores", async () => {
    mount("/admin/solicitudes", "OPERATOR");
    await screen.findByText("Solicitudes operador");
    const nav = screen.getByRole("navigation", { name: "Administración" });
    expect(within(nav).getByText("Solicitudes")).toBeInTheDocument();
    expect(within(nav).queryByText("Proveedores")).not.toBeInTheDocument();
  });
});
