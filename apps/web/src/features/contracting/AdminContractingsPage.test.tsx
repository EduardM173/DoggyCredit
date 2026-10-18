import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminContractingsPage } from "./AdminContractingsPage";
import type { ProvisioningProgress } from "./api";

const response = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body });
const base: ProvisioningProgress = {
  status: "FAILED_PERMANENT",
  errorCode: "PROVISIONING_INTERNAL_ERROR",
  nextAttemptAt: null,
  tenant: null,
  activation: null,
};

describe("HU-28 operator recovery actions", () => {
  const fetchMock = vi.fn();
  let progress: ProvisioningProgress;
  beforeEach(() => {
    progress = structuredClone(base);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      if (options?.method === "POST") return response(progress);
      return response({
        items: [
          {
            id: "contract",
            requestId: "request",
            institution: "Banco Demo",
            planName: "Básico",
            amount: "0.00",
            currency: "BOB",
            status: "CONFIRMED",
            createdAt: "2026-10-17T12:00:00Z",
            payments: [],
            provisioning: progress,
          },
        ],
        page: 1,
        pageSize: 10,
        total: 1,
        paymentProvider: "mock",
      });
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
  const mount = () =>
    render(
      <MemoryRouter>
        <AdminContractingsPage />
      </MemoryRouter>,
    );

  it("retries failed provisioning through the guarded backend action", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Reintentar preparación" }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, options]) =>
            url.endsWith("/admin/contractings/contract/provisioning/retry") && options.method === "POST",
        ),
      ).toBe(true),
    );
    expect(await screen.findByText(/reintento quedó registrado/)).toBeInTheDocument();
  });

  it("reports an invitation as pending when resend did not confirm delivery", async () => {
    progress = {
      status: "COMPLETED",
      errorCode: null,
      nextAttemptAt: null,
      tenant: { slug: "banco-demo", legalName: "Banco Demo" },
      activation: { status: "INVITED", delivery: "FAILED", sentAt: null },
    };
    mount();
    const resend = await screen.findByRole("button", { name: "Reenviar invitación" });
    expect(resend).toHaveClass("admin-secondary");
    fireEvent.click(resend);
    expect(await screen.findByText(/entrega aún no se confirmó/)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) =>
          url.endsWith("/admin/contractings/contract/initial-invitation/resend") && options.method === "POST",
      ),
    ).toBe(true);
  });
  it.each(["QUEUED", "SENT", "ACTIVATED"] as const)(
    "keeps %s invitation status legible without an unnecessary action",
    async (delivery) => {
      progress = {
        status: "COMPLETED",
        errorCode: null,
        nextAttemptAt: null,
        tenant: { slug: "banco-demo", legalName: "Banco Demo" },
        activation: { status: delivery === "ACTIVATED" ? "ACTIVE" : "INVITED", delivery, sentAt: null },
      };
      mount();
      expect(await screen.findByText(delivery === "ACTIVATED" ? "Lista para ingresar" : "Activación pendiente")).toBeInTheDocument();
      if (delivery === "QUEUED" || delivery === "ACTIVATED") {
        expect(screen.queryByRole("button", { name: "Reenviar invitación" })).not.toBeInTheDocument();
      } else {
        expect(screen.getByRole("button", { name: "Reenviar invitación" })).toHaveClass("admin-secondary");
      }
    },
  );
});
