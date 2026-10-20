import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminLayout } from "./AdminLayout";
import { PlatformTeamPage } from "./PlatformTeamPage";

const admin = {
  id: "admin",
  fullName: "Administradora",
  email: "admin@example.test",
  platformRole: "PLATFORM_ADMIN",
};
const operator = {
  id: "operator",
  fullName: "Operador Uno",
  email: "operador@example.test",
  role: "OPERATOR",
  status: "ACTIVE",
  invitation: null,
};
const reply = (data: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });

describe("HU-31 equipo interno", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  function mount(role = "PLATFORM_ADMIN") {
    const router = createMemoryRouter(
      [
        { path: "/admin/login", element: <p>Login</p> },
        {
          path: "/admin",
          element: <AdminLayout />,
          children: [
            { path: "equipo-interno", element: <PlatformTeamPage /> },
            { path: "solicitudes", element: <p>Solicitudes</p> },
            { path: "proveedores", element: <p>Proveedores</p> },
          ],
        },
      ],
      { initialEntries: ["/admin/equipo-interno"] },
    );
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith("/admin/auth/session"))
        return reply({ user: { ...admin, platformRole: role }, expiresAt: "2027-01-01T00:00:00Z" });
      if (url.endsWith("/admin/platform/team") && !init?.method) return reply([operator]);
      if (url.endsWith("/admin/platform/team/invitations"))
        return reply({ delivery: "ACCEPTED_BY_TRANSPORT" });
      if (url.includes("/operator/suspend")) return reply({ status: "SUSPENDED" });
      return reply({}, 404);
    });
    render(<RouterProvider router={router} />);
  }

  it("muestra el equipo, confirma una invitación de rol fijo y no afirma entrega final", async () => {
    mount();
    await screen.findByText("Operador Uno");
    expect(screen.getByRole("link", { name: /Equipo interno/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Invitar operador" }));
    const dialog = screen.getByRole("dialog", { name: "Invitar operador" });
    expect(dialog).toHaveTextContent("Rol: Operador");
    fireEvent.change(screen.getByLabelText("Nombre completo"), { target: { value: "Operadora Dos" } });
    fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: "dos@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar invitación" }));
    await screen.findByText(/El servicio de correo aceptó la invitación/);
    const call = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith("/admin/platform/team/invitations") && init?.method === "POST",
    );
    expect(JSON.parse(call?.[1]?.body as string)).toEqual({
      email: "dos@example.test",
      fullName: "Operadora Dos",
    });
  });

  it("confirma la suspensión antes de enviar la mutación", async () => {
    mount();
    await screen.findByText("Operador Uno");
    fireEvent.click(screen.getByRole("button", { name: "Suspender" }));
    expect(screen.getByRole("dialog", { name: "Suspender acceso" })).toHaveTextContent(
      "Se cerrarán sus sesiones internas",
    );
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/operator/suspend"))).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Suspender acceso" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/operator/suspend"))).toBe(true),
    );
  });

  it("no muestra gestión interna en la navegación del operador", async () => {
    mount("OPERATOR");
    await screen.findByText("Solicitudes");
    expect(screen.queryByRole("link", { name: /Equipo interno/ })).not.toBeInTheDocument();
  });
});
