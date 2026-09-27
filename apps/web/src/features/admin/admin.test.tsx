import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdminLayout } from "./AdminLayout";
import { AdminLoginPage } from "./AdminLoginPage";
import { ReviewListPage } from "./ReviewListPage";
import { ReviewDetailPage } from "./ReviewDetailPage";
import type { ReviewDetail } from "./api";

const session = {
  user: {
    id: "operator",
    fullName: "Operador Prueba",
    email: "operator@example.test",
    platformRole: "OPERATOR",
  },
  expiresAt: "2027-01-01T00:00:00Z",
};
const initial: ReviewDetail = {
  id: "request",
  institutionName: "Institución de prueba",
  taxId: "123456789",
  institutionType: "BANK",
  contactName: "Contacto Prueba",
  contactRole: "Gerente",
  contactEmail: "contact@example.test",
  contactPhone: "+59171234567",
  planInterest: "UNSURE",
  status: "PENDING_REVIEW",
  createdAt: "2026-09-26T10:00:00Z",
  emailVerifiedAt: "2026-09-26T10:01:00Z",
  reviewedAt: null,
  reviewer: null,
  rejectionReason: null,
};
const response = (data: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: async () => data });
function renderFlow(path = "/admin/solicitudes") {
  const router = createMemoryRouter(
    [
      { path: "/admin/login", element: <AdminLoginPage /> },
      {
        path: "/admin",
        element: <AdminLayout />,
        children: [
          { path: "solicitudes", element: <ReviewListPage /> },
          { path: "solicitudes/:id", element: <ReviewDetailPage /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}
describe("HU-03 administrative interface", () => {
  const fetchMock = vi.fn();
  let authorized: boolean;
  let detail: ReviewDetail;
  beforeEach(() => {
    authorized = true;
    detail = { ...initial };
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/auth/session")) return response(session, authorized ? 200 : 401);
      if (url.includes("institution-requests?"))
        return response({ items: [detail], page: 1, pageSize: 10, total: 11, totalPages: 2 });
      if (url.endsWith("/institution-requests/request")) return response(detail);
      if (url.endsWith("/auth/login")) {
        authorized = true;
        return response(session);
      }
      if (url.endsWith("/auth/logout")) {
        authorized = false;
        return response(null, 204);
      }
      if (url.endsWith("/approve") || url.endsWith("/reject")) {
        detail = {
          ...detail,
          status: url.endsWith("/approve") ? "APPROVED" : "REJECTED",
          reviewedAt: "2026-09-26T12:00:00Z",
          reviewer: { fullName: session.user.fullName },
        };
        return response(detail);
      }
      throw new Error("Unexpected test URL");
    });
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("redirects unauthenticated protected routes", async () => {
    authorized = false;
    const router = renderFlow();
    await screen.findByRole("heading", { name: "Iniciar sesión" });
    expect(router.state.location.pathname).toBe("/admin/login");
  });
  it("logs in with cookies without storing credentials and toggles password visibility", async () => {
    authorized = false;
    renderFlow("/admin/login");
    fireEvent.change(screen.getByLabelText("Correo electrónico"), {
      target: { value: "operator@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "test-password" } });
    fireEvent.click(screen.getByRole("button", { name: "Mostrar contraseña" }));
    expect(screen.getByLabelText("Contraseña")).toHaveAttribute("type", "text");
    const local = vi.spyOn(Storage.prototype, "setItem");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    await screen.findByRole("heading", { name: "Solicitudes" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/login"),
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({ "X-DoggyCredit-Admin": "1" }),
      }),
    );
    expect(local).not.toHaveBeenCalled();
  });
  it("shows incorrect credentials without enumerating accounts", async () => {
    authorized = false;
    fetchMock.mockImplementation((url: string) =>
      response(null, url.endsWith("/auth/login") || url.endsWith("/auth/session") ? 401 : 500),
    );
    renderFlow("/admin/login");
    fireEvent.change(screen.getByLabelText("Correo electrónico"), {
      target: { value: "operator@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Contraseña"), { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar sesión" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Credenciales incorrectas");
  });
  it("lists real response data, searches and sends state/date/pagination to backend", async () => {
    renderFlow();
    await screen.findByText("Institución de prueba");
    expect(screen.getByText("Informativo")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar por institución, NIT o correo"), {
      target: { value: "Banco" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("search=Banco"), expect.anything()),
    );
    await screen.findByText("Institución de prueba");
    fireEvent.change(screen.getByLabelText("Estado"), { target: { value: "APPROVED" } });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("status=APPROVED"), expect.anything()),
    );
    fireEvent.change(screen.getByLabelText("Fecha de solicitud (UTC)"), { target: { value: "2026-09-26" } });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("date=2026-09-26"), expect.anything()),
    );
    await screen.findByText("Institución de prueba");
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("page=2"), expect.anything()),
    );
    fireEvent.click(screen.getByRole("button", { name: "Limpiar filtros" }));
    await waitFor(() => expect(screen.getByLabelText("Estado")).toHaveValue(""));
  });
  for (const action of ["Aprobar", "Rechazar"]) {
    it(`${action} requires explicit confirmation and renders final state`, async () => {
      renderFlow("/admin/solicitudes/request");
      await screen.findByText("Institución de prueba", { selector: "h2" });
      expect(screen.getByText("Información comercial; no es un plan contratado.")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: `${action} solicitud` }));
      const dialog = screen.getByRole("dialog");
      expect(within(dialog).getByText(/¿Confirmas/)).toBeInTheDocument();
      expect(fetchMock.mock.calls.filter(([url]) => /\/(approve|reject)$/.test(url))).toHaveLength(0);
      if (action === "Rechazar")
        fireEvent.change(within(dialog).getByLabelText("Motivo de rechazo (opcional)"), {
          target: { value: "Información insuficiente" },
        });
      fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar decisión" }));
      await screen.findByText("Decisión registrada correctamente.");
      expect(screen.queryByRole("button", { name: `${action} solicitud` })).not.toBeInTheDocument();
      expect(
        screen.getByRole("heading", {
          name: action === "Aprobar" ? "Solicitud aprobada" : "Solicitud rechazada",
        }),
      ).toBeInTheDocument();
      if (action === "Rechazar")
        expect(
          screen.getByText("Esta solicitud no puede continuar a contratación ni aprovisionamiento."),
        ).toBeInTheDocument();
    });
  }
  it("prevents duplicate decisions while pending", async () => {
    const original = fetchMock.getMockImplementation()!;
    let resolve!: (value: unknown) => void;
    fetchMock.mockImplementation((url: string, options: unknown) =>
      url.endsWith("/approve")
        ? new Promise((done) => {
            resolve = done;
          })
        : original(url, options),
    );
    renderFlow("/admin/solicitudes/request");
    fireEvent.click(await screen.findByRole("button", { name: "Aprobar solicitud" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar decisión" }));
    expect(screen.getByRole("button", { name: "Registrando..." })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    await act(async () => {
      resolve(await response({ ...detail, status: "APPROVED" }));
    });
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/approve"))).toHaveLength(1);
  });
  it("refreshes the actual decision after 409 conflict", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, options: unknown) => {
      if (url.endsWith("/approve")) {
        detail = { ...detail, status: "REJECTED" };
        return response(null, 409);
      }
      return original(url, options);
    });
    renderFlow("/admin/solicitudes/request");
    fireEvent.click(await screen.findByRole("button", { name: "Aprobar solicitud" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar decisión" }));
    await screen.findByRole("heading", { name: "Solicitud rechazada" });
    expect(screen.getByText(/La solicitud cambió o ya fue resuelta/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Aprobar solicitud" })).not.toBeInTheDocument();
  });
  it("does not offer decisions for unverified mail", async () => {
    detail = { ...detail, status: "EMAIL_PENDING", emailVerifiedAt: null };
    renderFlow("/admin/solicitudes/request");
    await screen.findByText("Correo pendiente de verificación");
    expect(screen.queryByRole("button", { name: "Aprobar solicitud" })).not.toBeInTheDocument();
  });
  it("repeats an unchanged search without leaving the list loading", async () => {
    renderFlow();
    await screen.findByText("Institución de prueba");
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText("Institución de prueba");
    expect(screen.queryByText("Cargando solicitudes...")).not.toBeInTheDocument();
  });
  it("shows empty results without fake rows", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, options: unknown) =>
      url.includes("institution-requests?")
        ? response({ items: [], page: 1, pageSize: 10, total: 0, totalPages: 0 })
        : original(url, options),
    );
    renderFlow();
    await screen.findByText("No hay solicitudes con estos filtros.");
    expect(screen.queryByRole("link", { name: "Ver detalle" })).not.toBeInTheDocument();
  });
  it("shows list errors and retries successfully", async () => {
    const original = fetchMock.getMockImplementation()!;
    let failed = false;
    fetchMock.mockImplementation((url: string, options: unknown) => {
      if (url.includes("institution-requests?") && !failed) {
        failed = true;
        return response(null, 500);
      }
      return original(url, options);
    });
    renderFlow();
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await screen.findByText("Institución de prueba");
  });
  it("handles a missing detail", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, options: unknown) =>
      url.endsWith("/institution-requests/request") ? response(null, 404) : original(url, options),
    );
    renderFlow("/admin/solicitudes/request");
    expect(await screen.findByRole("alert")).toHaveTextContent("La solicitud no existe");
  });
  it("logs out server-side and returns to login", async () => {
    renderFlow();
    fireEvent.click(await screen.findByRole("button", { name: "Cerrar sesión" }));
    await screen.findByRole("heading", { name: "Iniciar sesión" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/logout"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });
});
