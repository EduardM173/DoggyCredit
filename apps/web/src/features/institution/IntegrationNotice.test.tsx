import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { IntegrationNotice } from "./IntegrationNotice";

function mockFetch(response: () => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(response));
}
const ok = (body: unknown) => () =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

describe("HU-23 T05 · IntegrationNotice", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("muestra el aviso cuando una fuente está temporalmente no disponible", async () => {
    mockFetch(
      ok([
        { providerName: "Buró crediticio simulado", availability: "TEMPORARILY_UNAVAILABLE", message: "Con interrupciones." },
        { providerName: "Fuente bancaria simulada", availability: "AVAILABLE", message: "Disponible." },
      ]),
    );
    render(<IntegrationNotice slug="banco-demo" />);
    expect(await screen.findByText("Fuentes con interrupción temporal")).toBeTruthy();
    expect(screen.queryByText(/Buró crediticio simulado/)).not.toBeNull();
    expect(screen.queryByText(/Fuente bancaria simulada/)).toBeNull();
  });

  it("no muestra nada si todo está disponible o es desconocido", async () => {
    mockFetch(
      ok([
        { providerName: "A", availability: "AVAILABLE", message: "Disponible." },
        { providerName: "B", availability: "UNKNOWN", message: "Sin información." },
      ]),
    );
    const { container } = render(<IntegrationNotice slug="banco-demo" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.innerHTML).toBe("");
  });

  it("no muestra nada si la consulta falla", async () => {
    mockFetch(() => Promise.reject(new Error("red")));
    const { container } = render(<IntegrationNotice slug="banco-demo" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(container.innerHTML).toBe("");
  });
});