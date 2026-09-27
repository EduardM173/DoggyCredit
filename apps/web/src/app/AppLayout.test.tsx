import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppLayout } from "./AppLayout";
import { HomePage } from "../pages/HomePage";

describe("AppLayout", () => {
  beforeEach(() => {
    vi.stubGlobal("scrollTo", vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  it("distinguishes an institutional request from signing in", () => {
    const testRouter = createMemoryRouter([
      { element: <AppLayout />, children: [{ path: "/", element: <HomePage /> }] },
    ]);

    render(<RouterProvider router={testRouter} />);

    expect(screen.getByRole("heading", { name: /evaluaciones crediticias claras/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", "/iniciar-sesion");
    for (const cta of screen.getAllByRole("link", { name: "Solicitar acceso" }))
      expect(cta).toHaveAttribute("href", "/solicitar-acceso");
    expect(screen.getByRole("link", { name: "Solicitar acceso con plan Profesional" })).toHaveAttribute(
      "href",
      "/solicitar-acceso?plan=PROFESSIONAL",
    );
  });
});
