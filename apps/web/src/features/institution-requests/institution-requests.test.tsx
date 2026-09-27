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

describe("HU-01 request flow", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("does not send an empty form and identifies invalid fields", () => {
    renderFlow();
    fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText("Ingresa el nombre o razón social.")).toBeInTheDocument();
    expect(screen.getByText("Selecciona el tipo de institución.")).toBeInTheDocument();
  });
  it("preselects the plan from the landing", async () => {
    renderFlow("/");
    fireEvent.click(screen.getByRole("link", { name: "Solicitar acceso con plan Profesional" }));
    expect(await screen.findByLabelText(/Plan de interés/)).toHaveValue("PROFESSIONAL");
  });
  it("uses the unsure option for an unrecognized plan", () => {
    renderFlow("/solicitar-acceso?plan=INVALID");
    expect(screen.getByLabelText(/Plan de interés/)).toHaveValue("UNSURE");
  });
  it("prevents a duplicate submit, posts the real contract and displays the returned email", async () => {
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const router = renderFlow("/solicitar-acceso?plan=INITIAL");
    fillForm();
    fireEvent.submit(screen.getByRole("form"));
    fireEvent.submit(screen.getByRole("form"));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /Enviando solicitud/ })).toBeDisabled();
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/api\/institution-requests$/);
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toMatchObject({
      institutionName: "Banco de Prueba",
      contactPhone: "+59171234567",
      planInterest: "INITIAL",
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
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: ["El correo no es válido."] }), { status }),
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
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderFlow();
    fillForm();
    fireEvent.submit(screen.getByRole("form"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Revisa tu conexión");
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(receipt), { status: 201 }));
    fireEvent.click(screen.getByRole("button", { name: "Enviar solicitud" }));
    expect(await screen.findByRole("heading", { name: "Solicitud recibida" })).toBeInTheDocument();
  });
  it("redirects direct confirmation visits without inventing a receipt", async () => {
    const router = renderFlow("/solicitud-recibida");
    await waitFor(() => expect(router.state.location.pathname).toBe("/solicitar-acceso"));
    expect(screen.getByRole("form")).toBeInTheDocument();
  });
});
