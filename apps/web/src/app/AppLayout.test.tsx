import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AppLayout } from "./AppLayout";
import { HomePage } from "../pages/HomePage";

describe("AppLayout", () => {
  it("renders the technical foundation home", () => {
    const testRouter = createMemoryRouter([
      { element: <AppLayout />, children: [{ path: "/", element: <HomePage /> }] },
    ]);

    render(<RouterProvider router={testRouter} />);

    expect(screen.getByRole("heading", { name: /base técnica lista/i })).toBeInTheDocument();
  });
});
