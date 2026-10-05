import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContractingPage } from "./ContractingPage";
import { DoggyPayPage } from "./DoggyPayPage";
import { type Context, type Payment } from "./api";

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,AAAA") } }));
const pending: Payment = {
  id: "payment",
  reference: "DC-PAY-TEST",
  method: "QR",
  amount: "349.00",
  currency: "BOB",
  status: "PENDING",
  initialized: true,
  createdAt: "2026-09-26T12:00:00Z",
  resolvedAt: null,
};
const initial: Context = {
  institution: {
    id: "request",
    institutionName: "Banco Demo",
    contactName: "Ana Prueba",
    contactEmail: "ana@example.test",
    planInterest: "UNSURE",
  },
  paymentProvider: "mock",
  contracting: null,
  plans: [
    {
      id: "free",
      code: "BASIC",
      name: "Básico",
      price: "0.00",
      currency: "BOB",
      billingPeriod: "MONTHLY",
      requiresPayment: false,
      features: [],
    },
    {
      id: "paid",
      code: "PROFESSIONAL",
      name: "Profesional",
      price: "349.00",
      currency: "BOB",
      billingPeriod: "MONTHLY",
      requiresPayment: true,
      features: [],
    },
  ],
};
const contract = (payment: Payment | null = null): Context => ({
  ...initial,
  contracting: {
    id: "contract",
    confirmedPlanId: "paid",
    planCode: "PROFESSIONAL",
    planName: "Profesional",
    price: "349.00",
    currency: "BOB",
    billingPeriod: "MONTHLY",
    requiresPayment: true,
    status: "PENDING_PAYMENT",
    confirmedAt: null,
    payment,
  },
});
const response = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => body });
describe("HU-04 contracting interface", () => {
  const fetchMock = vi.fn();
  let view: Context;
  beforeEach(() => {
    view = structuredClone(initial);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/contratacion#token=test-bootstrap");
    fetchMock.mockImplementation((url: string) => response(url.endsWith("/access") ? {} : view));
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.history.replaceState(null, "", "/");
  });
  const mount = () =>
    render(
      <StrictMode>
        <MemoryRouter>
          <ContractingPage />
        </MemoryRouter>
      </StrictMode>,
    );
  it("exchanges bootstrap once in StrictMode, removes fragment and stores no credentials", async () => {
    mount();
    await screen.findByRole("heading", { name: "Confirma tu plan" });
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/access"))).toHaveLength(1);
    expect(window.location.hash).toBe("");
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(screen.getByRole("button", { name: "Continuar con la contratación" })).toBeDisabled();
  });
  it("confirms a free plan without initiating a payment", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/plan"))
        return response({
          ...contract(),
          contracting: {
            ...contract().contracting!,
            requiresPayment: false,
            status: "CONFIRMED",
            price: "0.00",
            planName: "Básico",
          },
        });
      return response(url.endsWith("/access") ? {} : view);
    });
    mount();
    await screen.findByRole("heading", { name: "Confirma tu plan" });
    fireEvent.click(screen.getByRole("radio", { name: /Plan Básico/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar con la contratación" }));
    await screen.findByRole("heading", { name: "Contratación confirmada" });
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/payment"))).toBe(false);
    expect(screen.queryByText("Pago confirmado")).not.toBeInTheDocument();
  });
  it("starts QR with an idempotency key, without amounts from browser", async () => {
    view = contract();
    fetchMock.mockImplementation((url: string) =>
      response(
        url.endsWith("/checkout")
          ? { checkoutUrl: "http://example.test/doggypay-demo#token=demo", expiresAt: "2027-01-01T00:00:00Z" }
          : url.endsWith("/payment")
            ? contract(pending)
            : view,
      ),
    );
    mount();
    await screen.findByRole("heading", { name: "Elige tu método de pago" });
    fireEvent.click(screen.getByRole("radio", { name: /^QR/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar al pago" }));
    await screen.findByAltText("QR de checkout DoggyPay Demo");
    const [, options] = fetchMock.mock.calls.find(([url]) => url.endsWith("/payment"))!;
    expect(JSON.parse(options.body)).toEqual({ method: "QR" });
    expect(options.headers["Idempotency-Key"]).toMatch(/^[a-f0-9-]{36}$/);
    expect(screen.getByRole("link", { name: "Abrir DoggyPay Demo" })).toHaveAttribute(
      "href",
      "http://example.test/doggypay-demo#token=demo",
    );
  });
  it.each(["FAILED", "CANCELLED"] as const)(
    "allows new attempt after %s without showing confirmation",
    async (status) => {
      view = contract({ ...pending, status });
      mount();
      await screen.findByRole("button", { name: "Reintentar pago" });
      expect(screen.queryByRole("heading", { name: "Pago confirmado" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Reintentar pago" }));
      expect(screen.getByRole("heading", { name: "Elige tu método de pago" })).toBeInTheDocument();
    },
  );
  it("polls PENDING then stops after confirmation and unmount", async () => {
    vi.useFakeTimers();
    view = contract(pending);
    fetchMock.mockImplementation((url: string) =>
      response(
        url.endsWith("/status")
          ? {
              contractingStatus: "CONFIRMED",
              confirmedAt: "2026-09-26T12:01:00Z",
              payment: { ...pending, status: "PAID" },
            }
          : view,
      ),
    );
    const component = mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(screen.getByRole("heading", { name: "Pago confirmado" })).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12000);
    });
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/status"))).toHaveLength(1);
    component.unmount();
    await vi.advanceTimersByTimeAsync(9000);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/status"))).toHaveLength(1);
  });
  it("stops polling when session expires", async () => {
    vi.useFakeTimers();
    view = contract(pending);
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("/status") ? response({}, 401) : response(view),
    );
    mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/status"))).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("El acceso venció");
  });
  it("provider sends a simulated result only, using header capability", async () => {
    window.history.replaceState(null, "", "/doggypay-demo#token=checkout-token");
    fetchMock.mockImplementation((url: string) =>
      response(
        url.endsWith("/result") ? { status: "PAID" } : { ...pending, expiresAt: "2027-01-01T00:00:00Z" },
      ),
    );
    render(<DoggyPayPage />);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar pago simulado" }));
    await screen.findByText("Resultado registrado. Puedes volver a la computadora.");
    const [url, options] = fetchMock.mock.calls.find(([url]) => url.endsWith("/result"))!;
    expect(url).not.toContain("checkout-token");
    expect(options.headers["X-DoggyPay-Token"]).toBe("checkout-token");
    expect(JSON.parse(options.body)).toEqual({ result: "PAID" });
    expect(window.location.hash).toBe("");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });
  it("does not claim success when provider rejects expired checkout", async () => {
    fetchMock.mockImplementation(() => response({}, 410));
    render(<DoggyPayPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent("checkout venció");
    expect(screen.queryByText("Pago confirmado")).not.toBeInTheDocument();
  });
});
