import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RequestReceivedPage } from "../../pages/RequestReceivedPage";
import { VerifyEmailPage } from "../../pages/VerifyEmailPage";
import { ResendVerification } from "./ResendVerification";

const id = "11111111-1111-4111-8111-111111111111";
const token = "a".repeat(43);
const fetchMock = vi.fn();
function response(body: object, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}
function route(path: string, state?: object) {
  const router = createMemoryRouter(
    [
      { path: "/solicitud-recibida", element: <RequestReceivedPage /> },
      { path: "/verificar-correo", element: <VerifyEmailPage /> },
      { path: "/", element: <p>Inicio</p> },
    ],
    {
      initialEntries: [
        { pathname: path.split("?")[0], search: path.includes("?") ? `?${path.split("?")[1]}` : "", state },
      ],
    },
  );
  render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  return router;
}

describe("HU-02 email verification", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("shows a saved request with delivery failure and permits resend", async () => {
    route("/solicitud-recibida", {
      receipt: {
        id,
        contactEmail: "ana@example.test",
        status: "EMAIL_PENDING",
        emailDelivery: "FAILED",
        retryAfterSeconds: 0,
      },
    });
    expect(screen.getByText(/No pudimos confirmar el envío del correo/)).toBeInTheDocument();
    fetchMock.mockResolvedValue(response({ emailDelivery: "SENT", retryAfterSeconds: 60 }));
    fireEvent.click(screen.getByRole("button", { name: "Reenviar correo" }));
    expect(await screen.findByText(/Hemos enviado un enlace de verificación/)).toBeInTheDocument();
    expect(fetchMock.mock.calls[0][0]).toMatch(/email-verification\/resend$/);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ requestId: id });
    expect(screen.getByRole("button", { name: /Podrás reenviar en/ })).toBeDisabled();
  });
  it("counts down from an absolute deadline and enables resending", async () => {
    vi.useFakeTimers();
    render(<ResendVerification requestId={id} availableAt={Date.now() + 2000} />);
    expect(screen.getByRole("button", { name: /00:02/ })).toBeDisabled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByRole("button", { name: "Reenviar correo" })).toBeEnabled();
  });
  it("uses server Retry-After even if the local countdown allowed a resend", async () => {
    fetchMock.mockResolvedValue(response({ retryAfterSeconds: 42 }, 429, { "Retry-After": "42" }));
    render(<ResendVerification requestId={id} />);
    fireEvent.click(screen.getByRole("button", { name: "Reenviar correo" }));
    expect(await screen.findByRole("button", { name: /Podrás reenviar en 00:42/ })).toBeDisabled();
  });
  it("prevents simultaneous resend clicks", async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<ResendVerification requestId={id} />);
    const button = screen.getByRole("button", { name: "Reenviar correo" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish(response({ emailDelivery: "FAILED", retryAfterSeconds: 60 }));
    });
    expect(screen.getByRole("status")).toHaveTextContent("no pudimos confirmar el envío");
  });
  it("verifies only once in StrictMode, removes the token and shows the review state", async () => {
    fetchMock.mockResolvedValue(response({ contactEmail: "ana@example.test", status: "PENDING_REVIEW" }));
    const router = route(`/verificar-correo?token=${token}&requestId=${id}`);
    expect(
      await screen.findByRole("heading", { name: "¡Gracias! Tu correo ha sido verificado" }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token });
    expect(router.state.location.search).toBe("");
    expect(screen.getByText("En proceso")).toBeInTheDocument();
    expect(screen.getByText("ana@example.test")).toBeInTheDocument();
    expect(localStorage.getItem("token")).toBeNull();
    expect(sessionStorage.getItem("token")).toBeNull();
  });
  it.each(["inválido", "vencido", "usado", "invalidado"])(
    "shows an appropriate error for token %s",
    async () => {
      fetchMock.mockResolvedValue(response({ message: "Enlace no válido" }, 400));
      const router = route(`/verificar-correo?token=${token}&requestId=${id}`);
      expect(await screen.findByRole("alert")).toHaveTextContent(
        /venció, ya fue utilizado o fue reemplazado/,
      );
      expect(screen.getByRole("button", { name: "Reenviar correo" })).toBeEnabled();
      expect(router.state.location.search).toBe("");
      expect(screen.queryByText("CORREO CONFIRMADO")).not.toBeInTheDocument();
    },
  );
  it("permits an explicit retry after a network error without repeating automatically", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    route(`/verificar-correo?token=${token}`);
    expect(await screen.findByRole("alert")).toHaveTextContent("Revisa tu conexión");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValueOnce(response({ contactEmail: "ana@example.test", status: "PENDING_REVIEW" }));
    fireEvent.click(screen.getByRole("button", { name: "Reintentar verificación" }));
    expect(await screen.findByText("CORREO CONFIRMADO")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("handles server failure and missing tokens", async () => {
    route("/verificar-correo");
    expect(await screen.findByRole("alert")).toHaveTextContent("Abre el enlace");
    expect(fetchMock).not.toHaveBeenCalled();
    cleanup();
    fetchMock.mockResolvedValue(response({}, 500));
    route(`/verificar-correo?token=${token}`);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("unos minutos"));
    expect(screen.getByRole("button", { name: "Reintentar verificación" })).toBeEnabled();
  });
});
