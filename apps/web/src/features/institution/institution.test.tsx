import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstitutionLoginPage } from "./InstitutionLoginPage";
import { InstitutionSelectPage } from "./InstitutionSelectPage";
import { InstitutionHomePage } from "./InstitutionHomePage";
import { authorizedReturnTo, destination } from "./api";

const user = { id: "user", fullName: "Ana María López", email: "ana@example.test" };
const x = { tenant: { name: "Banco X", slug: "banco-x" }, role: "INSTITUTION_ADMIN" };
const y = { tenant: { name: "Banco Y", slug: "banco-y" }, role: "INSTITUTION_ADMIN" };
const response = (data: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });
const mount = (path: string) => {
  const router = createMemoryRouter(
    [
      { path: "/iniciar-sesion", element: <InstitutionLoginPage /> },
      { path: "/elegir-institucion", element: <InstitutionSelectPage /> },
      { path: "/:tenantSlug", element: <InstitutionHomePage /> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
};
describe("HU-07 institutional interface", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  it("asks only for global credentials and redirects a single membership", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/auth/login")) return response({ resolution: "SINGLE_TENANT" });
      if (url.endsWith("/auth/me"))
        return fetchMock.mock.calls.some(([path]) => String(path).endsWith("/auth/login"))
          ? response({ user, activeMemberships: [x] })
          : response({}, 401);
      return response({
        user: { name: user.fullName },
        tenant: { name: "Banco X", slug: "banco-x", taxId: "123", type: "BANK" },
        membership: { role: "INSTITUTION_ADMIN", status: "ACTIVE" },
      });
    });
    const router = mount("/iniciar-sesion");
    expect(screen.getByLabelText("Correo electrónico")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("autocomplete", "current-password");
    expect(screen.queryByLabelText("Banco")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "frase de prueba" } });
    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/banco-x"));
    expect(await screen.findByText("123")).toBeInTheDocument();
    const loginCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/auth/login"));
    expect(JSON.parse(loginCall?.[1].body)).toEqual({ email: user.email, password: "frase de prueba" });
    expect(loginCall?.[1].credentials).toBe("include");
  });
  it("rejects external, scheme-relative and unauthorized returnTo", () => {
    for (const value of ["https://evil.test", "//evil.test", "javascript:alert(1)", "/banco-y", "/admin"])
      expect(authorizedReturnTo(value, [x])).toBeNull();
    expect(authorizedReturnTo("/banco-x", [x])).toBe("/banco-x");
    expect(destination({ user, activeMemberships: [] }, "/banco-x")).toBe("/elegir-institucion");
    expect(destination({ user, activeMemberships: [x] }, "/banco-y")).toBe("/banco-x");
    expect(destination({ user, activeMemberships: [x, y] }, null)).toBe("/elegir-institucion");
    expect(destination({ user, activeMemberships: [x, y] }, "/banco-y")).toBe("/banco-y");
  });
  it("shows only active memberships in the selector and can sign out", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("/auth/me") ? response({ user, activeMemberships: [x, y] }) : response({}, 204),
    );
    mount("/elegir-institucion");
    expect(await screen.findByRole("button", { name: "Banco X" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Banco Y" })).toBeInTheDocument();
    expect(screen.queryByText("Banco Z")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/auth/logout"))).toBe(true),
    );
  });
  it("does not render tenant data when the backend denies a forged slug", async () => {
    fetchMock.mockImplementation(() => response({}, 403));
    mount("/banco-y");
    expect(await screen.findByRole("alert")).toHaveTextContent("No tienes acceso");
    expect(screen.queryByText("Banco Y")).not.toBeInTheDocument();
  });
  it("hides the previous tenant immediately while a new slug is checked", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes("/banco-x/")
        ? response({
            user: { name: user.fullName },
            tenant: { name: "Banco X", slug: "banco-x", taxId: "123", type: "BANK" },
            membership: { role: "INSTITUTION_ADMIN", status: "ACTIVE" },
          })
        : new Promise(() => {}),
    );
    const router = mount("/banco-x");
    await screen.findByText("123");
    await act(async () => router.navigate("/banco-y"));
    expect(screen.queryByText("123")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Comprobando acceso");
  });
});
