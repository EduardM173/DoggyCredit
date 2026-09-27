import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivationPage } from "./ActivationPage";

const token = "a".repeat(43);
const preview = {
  valid: true,
  institution: { name: "Banco Real" },
  invitedUser: { name: "Ana Real", email: "ana@real.test" },
  requiresCredentialSetup: true,
  expiresAt: "2026-09-28T00:00:00Z",
};
const response = (data: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });
describe("HU-06 activation page", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/activar-cuenta#token=" + token);
    fetchMock.mockImplementation(() => response(preview));
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  const mount = () => {
    const router = createMemoryRouter(
      [
        { path: "/activar-cuenta", element: <ActivationPage /> },
        { path: "/", element: <p>Home</p> },
      ],
      { initialEntries: ["/activar-cuenta"] },
    );
    render(<RouterProvider router={router} />);
  };
  it("removes token from URL, previews via POST, and shows real non-editable context", async () => {
    mount();
    await screen.findAllByText("Banco Real");
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("");
    expect(screen.getByText("Ana Real")).toBeInTheDocument();
    expect(screen.getByText("ana@real.test")).toBeInTheDocument();
    expect(screen.queryByLabelText("NIT")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toContain("/membership-invitations/preview");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    expect(fetchMock.mock.calls[0][1].body).toContain(token);
  });
  it("shows password manager field, supports paste and show/hide, then activates", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("/preview") ? response(preview) : response({ activated: true }),
    );
    mount();
    const input = (await screen.findByLabelText("Nueva contraseña")) as HTMLInputElement;
    expect(input).toHaveAttribute("autocomplete", "new-password");
    fireEvent.change(input, { target: { value: "una frase larga de prueba" } });
    const confirmation = screen.getByLabelText("Confirmar contraseña");
    expect(confirmation).toHaveAttribute("autocomplete", "new-password");
    fireEvent.change(confirmation, { target: { value: "una frase larga de prueba" } });
    expect(screen.getByText("Mínimo cumplido")).toBeInTheDocument();
    expect(screen.getByText("Las contraseñas coinciden.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(input.type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Ocultar contraseña" }));
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Activar cuenta" }));
    await screen.findByRole("heading", { name: "Cuenta activada" });
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/activate"));
    expect(JSON.parse(call?.[1].body)).toEqual({ token, password: "una frase larga de prueba" });
  });
  it("does not require or replace credentials for existing user", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("/preview")
        ? response({ ...preview, requiresCredentialSetup: false })
        : response({ activated: true }),
    );
    mount();
    await screen.findByRole("heading", { name: "Activa tu acceso" });
    expect(screen.queryByLabelText("Nueva contraseña")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Activar acceso" }));
    await screen.findByRole("heading", { name: "Cuenta activada" });
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/activate"));
    expect(JSON.parse(call?.[1].body)).toEqual({ token });
  });
  it("invalid, expired and used links never show an active form", async () => {
    fetchMock.mockImplementation(() => response({ message: "El enlace ya fue utilizado." }, 400));
    mount();
    await screen.findByText("El enlace ya fue utilizado.");
    expect(screen.queryByRole("button", { name: "Activar cuenta" })).not.toBeInTheDocument();
  });
  it("disables duplicate submit while activation is pending", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("/preview") ? response(preview) : new Promise(() => {}),
    );
    mount();
    const input = await screen.findByLabelText("Nueva contraseña");
    fireEvent.change(input, { target: { value: "una frase larga de prueba" } });
    fireEvent.change(screen.getByLabelText("Confirmar contraseña"), {
      target: { value: "una frase larga de prueba" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Activar cuenta" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Activando..." })).toBeDisabled());
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/activate"))).toHaveLength(1);
  });
  it("updates the length requirement live and rejects a different confirmation", async () => {
    mount();
    const input = await screen.findByLabelText("Nueva contraseña");
    const confirmation = screen.getByLabelText("Confirmar contraseña");
    fireEvent.change(input, { target: { value: "frase corta" } });
    expect(screen.getByText("11 de 15 caracteres")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "11");
    fireEvent.change(input, { target: { value: "una frase larga de prueba" } });
    fireEvent.change(confirmation, { target: { value: "otra frase larga de prueba" } });
    expect(confirmation).toHaveAttribute("aria-invalid", "true");
    fireEvent.click(screen.getByRole("button", { name: "Activar cuenta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Las contraseñas no coinciden.");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/activate"))).toHaveLength(0);
    fireEvent.change(confirmation, { target: { value: "una frase larga de prueba" } });
    expect(confirmation).toHaveAttribute("aria-invalid", "false");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("counts normalized Unicode characters and caps the requirement at 128", async () => {
    mount();
    const input = await screen.findByLabelText("Nueva contraseña");
    fireEvent.change(input, { target: { value: "🔐".repeat(15) } });
    expect(screen.getByText("Mínimo cumplido")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "15");
    fireEvent.change(input, { target: { value: "x".repeat(129) } });
    expect(screen.getByText("Máximo 128 caracteres")).toBeInTheDocument();
  });
  it("never submits a password shorter than the minimum", async () => {
    mount();
    const input = await screen.findByLabelText("Nueva contraseña");
    const confirmation = screen.getByLabelText("Confirmar contraseña");
    fireEvent.change(input, { target: { value: "frase corta" } });
    fireEvent.change(confirmation, { target: { value: "frase corta" } });
    fireEvent.click(screen.getByRole("button", { name: "Activar cuenta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("entre 15 y 128 caracteres");
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/activate"))).toHaveLength(0);
  });
});
