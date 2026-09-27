import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstitutionRequestPage } from "../../pages/InstitutionRequestPage";
import { RequestReceivedPage } from "../../pages/RequestReceivedPage";
import { HomePage } from "../../pages/HomePage";

function renderFlow(initial = "/solicitar-acceso") {
  const router = createMemoryRouter(
    [
      { path: "/", element: <HomePage /> },
      { path: "/solicitar-acceso", element: <InstitutionRequestPage /> },
      { path: "/solicitud-recibida", element: <RequestReceivedPage /> },
    ],
    { initialEntries: [initial] },
  );
  render(<RouterProvider router={router} />);
  return router;
}
function fillForm() {
  for (const [label, value] of [
    [/Nombre o razón social/, "Banco de Prueba"],
    [/NIT/, "1234567890"],
    [/Nombre completo/, "Ana Prueba"],
    [/Cargo/, "Gerente"],
    [/Correo corporativo/, "ana@example.test"],
    [/Teléfono/, "71234567"],
  ] as const)
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole("radio", { name: "Banco" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Confirmo que represento/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Acepto los términos/ }));
}
const receipt = {
  id: "test-request",
  contactEmail: "ana@example.test",
  status: "EMAIL_PENDING",
  emailDelivery: "SENT",
  retryAfterSeconds: 60,
};
const catalog = [
  {
    code: "BASIC",
    name: "Básico",
    shortDescription: null,
    price: "0.00",
    currency: "BOB",
    billingPeriod: "MONTHLY",
    requiresPayment: false,
    highlights: ["Funciones esenciales"],
  },
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
  {
    code: "ENTERPRISE",
    name: "Empresarial",
    shortDescription: null,
    price: "799.00",
    currency: "BOB",
    billingPeriod: "MONTHLY",
    requiresPayment: true,
    highlights: ["Integraciones personalizadas"],
  },
];

describe("HU-01 request flow", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("/public/plans")
        ? Promise.resolve(new Response(JSON.stringify(catalog)))
        : Promise.resolve(new Response(JSON.stringify(receipt), { status: 201 })),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not send an empty form and identifies invalid fields", () => {
    renderFlow();
    fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
    expect(fetchMock.mock.calls.every(([url]) => String(url).endsWith("/public/plans"))).toBe(true);
    expect(screen.getByText("Ingresa el nombre o razón social.")).toBeInTheDocument();
    expect(screen.getByText("Selecciona el tipo de institución.")).toBeInTheDocument();
  });
  it("preselects the plan from the landing", async () => {
    renderFlow("/");
    fireEvent.click(await screen.findByRole("link", { name: "Me interesa el plan Profesional" }));
    expect(await screen.findByLabelText(/Plan de interés/)).toHaveValue("PROFESSIONAL");
  });
  it.each(catalog)("passes $code from the landing to HU-01 as plan interest", async (plan) => {
    renderFlow("/");
    fireEvent.click(await screen.findByRole("link", { name: `Me interesa el plan ${plan.name}` }));
    expect(await screen.findByLabelText(/Plan de interés/)).toHaveValue(plan.code);
    expect(fetchMock.mock.calls.every(([url]) => String(url).endsWith("/public/plans"))).toBe(true);
  });
  it("keeps the general request CTA available when plans cannot load", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderFlow("/");
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(await screen.findByText(/No pudimos mostrar los planes/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Solicitar acceso/ }).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Bs 349/)).not.toBeInTheDocument();
  });
  it("handles an empty public catalog without inventing offers", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify([])));
    renderFlow("/");
    expect(await screen.findByText(/No hay planes públicos disponibles/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Me interesa el plan/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: /Solicitar acceso/ }).length).toBeGreaterThan(0);
  });
  it("uses the unsure option for an unrecognized plan", () => {
    renderFlow("/solicitar-acceso?plan=INVALID");
    expect(screen.getByLabelText(/Plan de interés/)).toHaveValue("UNSURE");
  });
  it("prevents a duplicate submit, posts the real contract and displays the returned email", async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation((url: string) =>
      url.endsWith("/public/plans")
        ? Promise.resolve(new Response(JSON.stringify(catalog)))
        : new Promise<Response>((resolve) => {
            finish = resolve;
          }),
    );
    const router = renderFlow("/solicitar-acceso?plan=BASIC");
    await waitFor(() => expect(screen.getByLabelText(/Plan de interés/)).toHaveValue("BASIC"));
    fillForm();
    fireEvent.submit(screen.getByRole("form"));
    fireEvent.submit(screen.getByRole("form"));
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/institution-requests")),
    ).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Enviando solicitud/ })).toBeDisabled();
    const [url, options] = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/institution-requests"),
    )!;
    expect(url).toMatch(/\/api\/institution-requests$/);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toMatchObject({
      institutionName: "Banco de Prueba",
      contactPhone: "+59171234567",
      planInterest: "BASIC",
      representsInstitution: true,
      acceptsTerms: true,
    });
    expect(JSON.parse(options.body)).not.toHaveProperty("status");
    await act(async () => {
      finish(new Response(JSON.stringify(receipt), { status: 201 }));
    });
    expect(await screen.findByRole("heading", { name: "Solicitud recibida" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/solicitud-recibida");
    expect(screen.getByText(receipt.contactEmail)).toBeInTheDocument();
    expect(screen.getByText(/Hemos enviado un enlace de verificación/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Podrás reenviar en/ })).toBeDisabled();
  });
  it.each([
    [409, "Ya existe una solicitud"],
    [500, "No pudimos procesar la solicitud"],
    [400, "El correo no es válido."],
  ])("shows HTTP %s errors and preserves the form", async (status, message) => {
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith("/public/plans")
          ? new Response(JSON.stringify(catalog))
          : new Response(JSON.stringify({ message: ["El correo no es válido."] }), { status }),
      ),
    );
    const router = renderFlow();
    fillForm();
    fireEvent.submit(screen.getByRole("form"));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText(/Nombre o razón social/)).toHaveValue("Banco de Prueba");
    expect(router.state.location.pathname).toBe("/solicitar-acceso");
    expect(screen.getByRole("button", { name: "Enviar solicitud" })).toBeEnabled();
  });
  it("shows network failures and permits a retry", async () => {
    let postCount = 0;
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/public/plans")) return Promise.resolve(new Response(JSON.stringify(catalog)));
      return ++postCount === 1
        ? Promise.reject(new TypeError("Failed to fetch"))
        : Promise.resolve(new Response(JSON.stringify(receipt), { status: 201 }));
    });
    renderFlow();
    fillForm();
    fireEvent.submit(screen.getByRole("form"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Revisa tu conexión");
    fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
    expect(await screen.findByRole("heading", { name: "Solicitud recibida" })).toBeInTheDocument();
  });
  it("redirects direct confirmation visits without inventing a receipt", async () => {
    const router = renderFlow("/solicitud-recibida");
    await waitFor(() => expect(router.state.location.pathname).toBe("/solicitar-acceso"));
    expect(screen.getByRole("form")).toBeInTheDocument();
  });
});
