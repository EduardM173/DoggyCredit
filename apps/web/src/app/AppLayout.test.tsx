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
  it("distinguishes an institutional request from signing in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              code: "PROFESSIONAL",
              name: "Profesional",
              shortDescription: null,
              price: "349.00",
              currency: "BOB",
              billingPeriod: "MONTHLY",
              requiresPayment: true,
              highlights: ["Soporte prioritario"],
            },
          ]),
        ),
      ),
    );
    const testRouter = createMemoryRouter([
      { element: <AppLayout />, children: [{ path: "/", element: <HomePage /> }] },
    ]);

    render(<RouterProvider router={testRouter} />);

    expect(screen.getByRole("heading", { name: /evaluaciones crediticias claras/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Iniciar sesión" })).toHaveAttribute("href", "/iniciar-sesion");
    for (const cta of screen.getAllByRole("link", { name: "Solicitar acceso" }))
      expect(cta).toHaveAttribute("href", "/solicitar-acceso");
    expect(await screen.findByRole("link", { name: "Me interesa el plan Profesional" })).toHaveAttribute(
      "href",
      "/solicitar-acceso?plan=PROFESSIONAL",
    );
  });
});
