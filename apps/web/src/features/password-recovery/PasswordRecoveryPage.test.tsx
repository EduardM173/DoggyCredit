import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PasswordRecoveryPage } from "./PasswordRecoveryPage";

const token = "a".repeat(43);
const response = (data: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });

describe("HU-33 password recovery page", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  function mount(path: string, reset = false) {
    window.history.replaceState({}, "", path);
    const router = createMemoryRouter(
      [
        { path: "/recuperar-contrasena", element: <PasswordRecoveryPage /> },
        { path: "/restablecer-contrasena", element: <PasswordRecoveryPage reset={reset} /> },
        { path: "/iniciar-sesion", element: <p>Login institucional</p> },
        { path: "/admin/login", element: <p>Login interno</p> },
      ],
      { initialEntries: [path] },
    );
    render(<RouterProvider router={router} />);
  }

  it("uses a generic confirmation and preserves the internal login destination", async () => {
    fetchMock.mockImplementation(() =>
      response({
        message:
          "Si existe una cuenta asociada a este correo, recibirás instrucciones para recuperar el acceso.",
      }),
    );
    mount("/recuperar-contrasena?from=internal");
    fireEvent.change(screen.getByLabelText("Correo electrónico"), {
      target: { value: "persona@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Enviar enlace de recuperación/ }));
    await screen.findByRole("heading", { name: "Revisa tu correo" });
    expect(screen.getByRole("link", { name: /Iniciar sesión/ })).toHaveAttribute("href", "/admin/login");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: "persona@example.test" });
  });

  it("removes the token from the URL, previews without consuming, then resets", async () => {
    fetchMock.mockImplementation((url: string) =>
      response(url.endsWith("/preview") ? { valid: true } : { completed: true }),
    );
    mount(`/restablecer-contrasena#token=${token}`, true);
    await screen.findByLabelText("Nueva contraseña");
    expect(window.location.hash).toBe("");
    expect(fetchMock.mock.calls[0][0]).toContain("/preview");
    fireEvent.change(screen.getByLabelText("Nueva contraseña"), {
      target: { value: "Frase nueva segura para pruebas" },
    });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña"), {
      target: { value: "Frase nueva segura para pruebas" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Guardar nueva contraseña/ }));
    await screen.findByRole("heading", { name: "Contraseña actualizada" });
    const sent = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(sent.token).toBe(token);
    expect(sent.password).toBe(sent.confirmation);
  });

  it("offers a new request for an invalid link", async () => {
    fetchMock.mockImplementation(() => response({ message: "El enlace no es válido" }, 400));
    mount(`/restablecer-contrasena#token=${token}`, true);
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /Solicitar un enlace nuevo/ })).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("Nueva contraseña")).not.toBeInTheDocument();
  });

  it("offers a new link if the token expires while editing", async () => {
    fetchMock.mockImplementation((url: string) =>
      response(url.endsWith("/preview") ? { valid: true } : { message: "El enlace no es válido, venció o ya fue utilizado." }, url.endsWith("/preview") ? 200 : 400),
    );
    mount(`/restablecer-contrasena#token=${token}`, true);
    fireEvent.change(await screen.findByLabelText("Nueva contraseña"), { target: { value: "Frase nueva segura para pruebas" } });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña"), { target: { value: "Frase nueva segura para pruebas" } });
    fireEvent.click(screen.getByRole("button", { name: /Guardar nueva contraseña/ }));
    await screen.findByRole("link", { name: /Solicitar un enlace nuevo/ });
    expect(screen.queryByLabelText("Nueva contraseña")).not.toBeInTheDocument();
  });
});
