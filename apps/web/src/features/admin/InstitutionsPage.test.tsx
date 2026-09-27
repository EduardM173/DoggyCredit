import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { InstitutionsPage } from "./InstitutionsPage";
import { AdminLayout } from "./AdminLayout";
const row = {
  tenantId: "tenant",
  institutionName: "Banco Prueba",
  nit: "123456",
  initialAdmin: { name: "Ana", email: "ana@example.test" },
  activationStatus: "INVITED",
  approvedAt: "2026-09-20T12:00:00Z",
};
const response = (data: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });
describe("HU-05 institutions", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation(() => response({ items: [row], total: 11, page: 1, pageSize: 10 }));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  const mount = () => {
    const router = createMemoryRouter(
      [
        { path: "/admin/instituciones", element: <InstitutionsPage /> },
        { path: "/admin/login", element: <p>Login required</p> },
      ],
      { initialEntries: ["/admin/instituciones"] },
    );
    render(<RouterProvider router={router} />);
    return router;
  };
  it("shows loading before API data", async () => {
    fetchMock.mockImplementation(() => new Promise(() => {}));
    mount();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando instituciones");
  });
  it("renders real projection and membership invitation status", async () => {
    mount();
    await screen.findByText("Banco Prueba");
    expect(screen.getByText("ana@example.test")).toBeInTheDocument();
    expect(screen.getAllByText("Invitación pendiente").length).toBe(2);
    expect(screen.getByText("123456")).toBeInTheDocument();
    expect(screen.getByText("11 instituciones")).toBeInTheDocument();
  });
  it("never fabricates missing approval date", async () => {
    fetchMock.mockImplementation(() =>
      response({ items: [{ ...row, approvedAt: null }], total: 1, page: 1, pageSize: 10 }),
    );
    mount();
    await screen.findByText("No registrada");
  });
  it("supports empty result", async () => {
    fetchMock.mockImplementation(() => response({ items: [], total: 0, page: 1, pageSize: 10 }));
    mount();
    await screen.findByText("No hay instituciones que coincidan con la búsqueda.");
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeDisabled();
  });
  it("supports error and retry", async () => {
    fetchMock.mockImplementationOnce(() => response({}, 503));
    mount();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByText("Banco Prueba");
  });
  it("sends search, activation filter and pagination to backend", async () => {
    mount();
    await screen.findByText("Banco Prueba");
    fireEvent.change(screen.getByLabelText("Buscar por institución, NIT o administrador"), {
      target: { value: "  Ana  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(fetchMock.mock.lastCall?.[0]).toContain("search=Ana"));
    await screen.findByText("Banco Prueba");
    fireEvent.change(screen.getByLabelText("Activación"), { target: { value: "INVITED" } });
    await waitFor(() => expect(fetchMock.mock.lastCall?.[0]).toContain("activationStatus=INVITED"));
    await screen.findByText("Banco Prueba");
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    await waitFor(() => expect(fetchMock.mock.lastCall?.[0]).toContain("page=2"));
  });
  it("401 returns to administrative login", async () => {
    fetchMock.mockImplementation(() => response({}, 401));
    const router = mount();
    await screen.findByText("Login required");
    expect(router.state.location.pathname).toBe("/admin/login");
  });
  it("403 displays permission error, not private data", async () => {
    fetchMock.mockImplementation(() => response({}, 403));
    mount();
    await screen.findByRole("alert");
    expect(screen.queryByText("Banco Prueba")).not.toBeInTheDocument();
  });
  it("ACTIVE badge depends on membership projection", async () => {
    fetchMock.mockImplementation(() =>
      response({ items: [{ ...row, activationStatus: "ACTIVE" }], total: 1, page: 1, pageSize: 10 }),
    );
    mount();
    await screen.findByText("Banco Prueba");
    expect(screen.getAllByText("Cuenta activa").length).toBe(2);
  });
  it("reuses admin layout and session for institutions navigation", async () => {
    fetchMock.mockImplementation((url: string) =>
      response(
        url.includes("/auth/session")
          ? {
              user: {
                id: "operator",
                fullName: "Operador Prueba",
                email: "operator@example.test",
                platformRole: "OPERATOR",
              },
              expiresAt: "2027-01-01",
            }
          : { items: [row], total: 1, page: 1, pageSize: 10 },
      ),
    );
    const router = createMemoryRouter(
      [
        {
          path: "/admin",
          element: <AdminLayout />,
          children: [{ path: "instituciones", element: <InstitutionsPage /> }],
        },
      ],
      { initialEntries: ["/admin/instituciones"] },
    );
    render(<RouterProvider router={router} />);
    await screen.findByText("Banco Prueba");
    expect(screen.getByRole("link", { name: "Instituciones" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Operador Prueba")).toBeInTheDocument();
  });
});
