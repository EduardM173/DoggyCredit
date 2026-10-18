import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeamPanel } from "./TeamPanel";

const administrator = {
  id: "admin",
  name: "Ana Real",
  email: "ana@real.test",
  role: "INSTITUTION_ADMIN",
  status: "ACTIVE",
  isInitialAdmin: true,
  invitation: null,
};
const team = {
  tenant: { name: "Banco Real", slug: "banco-real" },
  actorMembershipId: "admin",
  members: [administrator],
};
const response = (data: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => data });

describe("HU-09 team page", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => response(team));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the backend team and sends only the email from the invite modal", async () => {
    const pending = {
      id: "analyst",
      name: null,
      email: "analista@real.test",
      role: "ANALYST",
      status: "INVITED",
      isInitialAdmin: false,
      invitation: {
        id: "invite-1",
        sentAt: "2026-10-06T00:00:00Z",
        expiresAt: "2026-10-08T00:00:00Z",
        lastSendErrorCode: null,
      },
    };
    fetchMock.mockImplementation((_url: string, options?: RequestInit) =>
      response(
        options?.method === "POST"
          ? { emailSent: true, team: { ...team, members: [administrator, pending] } }
          : team,
      ),
    );
    render(
      <MemoryRouter>
        <TeamPanel slug="banco-real" tenantName="Banco Real" />
      </MemoryRouter>,
    );
    await screen.findByText("Ana Real");
    expect(screen.getByText("Todavía no hay analistas activos.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Invitar analista" }));
    expect(screen.getByRole("dialog", { name: "Invitar analista" })).toBeInTheDocument();
    expect(screen.getByText("Analista")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Correo electrónico"), {
      target: { value: "analista@real.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar invitación" }));
    await screen.findByText("analista@real.test");
    const post = fetchMock.mock.calls.find(([, options]) => options?.method === "POST");
    expect(JSON.parse(post?.[1].body)).toEqual({ email: "analista@real.test", role: "ANALYST" });
    expect(screen.getAllByText("Invitación pendiente")).toHaveLength(2);
  });

  it("keeps the email in the dialog after a recoverable duplicate", async () => {
    fetchMock.mockImplementation((_url: string, options?: RequestInit) =>
      options?.method === "POST"
        ? Promise.resolve({
            ok: false,
            status: 409,
            json: async () => ({ message: "Ya hay una invitación pendiente para este correo." }),
          })
        : response(team),
    );
    render(
      <MemoryRouter>
        <TeamPanel slug="banco-real" tenantName="Banco Real" />
      </MemoryRouter>,
    );
    await screen.findByText("Ana Real");
    fireEvent.click(screen.getByRole("button", { name: "Invitar analista" }));
    fireEvent.change(screen.getByLabelText("Correo electrónico"), {
      target: { value: "analista@real.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Enviar invitación" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Ya hay una invitación pendiente"),
    );
    expect(screen.getByLabelText("Correo electrónico")).toHaveValue("analista@real.test");
  });

  it("confirms a pending invitation cancellation and refreshes the persisted team", async () => {
    const pending = {
      id: "analyst",
      name: null,
      email: "analista@real.test",
      role: "ANALYST",
      status: "INVITED",
      isInitialAdmin: false,
      invitation: {
        id: "invite-1",
        sentAt: "2026-10-06T00:00:00Z",
        expiresAt: "2026-10-08T00:00:00Z",
        lastSendErrorCode: null,
      },
    };
    const current = { ...team, members: [administrator, pending] };
    fetchMock.mockImplementation((_url: string, options?: RequestInit) =>
      response(
        options?.method === "POST"
          ? { ...team, members: [administrator, { ...pending, status: "REVOKED", invitation: null }] }
          : current,
      ),
    );
    render(
      <MemoryRouter>
        <TeamPanel slug="banco-real" tenantName="Banco Real" />
      </MemoryRouter>,
    );
    await screen.findByText("analista@real.test");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByRole("dialog", { name: "Cancelar invitación" })).toHaveTextContent("Banco Real");
    fireEvent.click(
      screen.getByRole("dialog", { name: "Cancelar invitación" }).querySelector(".team-action-submit")!,
    );
    await screen.findByText("Revocado");
    expect(
      fetchMock.mock.calls.some(
        ([url, options]) => String(url).endsWith("/members/analyst/cancel") && options?.method === "POST",
      ),
    ).toBe(true);
  });

  it("reconciles an uncertain response against the saved access state", async () => {
    const analyst = {
      id: "analyst",
      name: "Carlos",
      email: "carlos@real.test",
      role: "ANALYST",
      status: "ACTIVE",
      isInitialAdmin: false,
      invitation: null,
    };
    let changed = false;
    fetchMock.mockImplementation((_url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        changed = true;
        return Promise.reject(new Error("NetworkError"));
      }
      return response({
        ...team,
        members: [administrator, { ...analyst, status: changed ? "SUSPENDED" : "ACTIVE" }],
      });
    });
    render(
      <MemoryRouter>
        <TeamPanel slug="banco-real" tenantName="Banco Real" />
      </MemoryRouter>,
    );
    await screen.findByText("Carlos");
    fireEvent.click(screen.getByRole("button", { name: "Suspender" }));
    const dialog = screen.getByRole("dialog", { name: "Suspender acceso" });
    expect(dialog.textContent?.match(/carlos@real\.test/g)).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Suspender acceso" }));
    await screen.findByText("Suspendido");
    expect(screen.getByRole("status")).toHaveTextContent("estado guardado confirma");
  });

  it("presents revocation as danger and keeps replacement invitation details", async () => {
    const analyst = {
      id: "analyst",
      name: "Carlos",
      email: "carlos@real.test",
      role: "ANALYST",
      status: "ACTIVE",
      isInitialAdmin: false,
      invitation: null,
    };
    fetchMock.mockImplementation(() => response({ ...team, members: [administrator, analyst] }));
    render(
      <MemoryRouter>
        <TeamPanel slug="banco-real" tenantName="Banco Real" />
      </MemoryRouter>,
    );
    await screen.findByText("Carlos");
    fireEvent.click(screen.getByRole("button", { name: "Revocar" }));
    const revoke = screen.getByRole("dialog", { name: "Revocar acceso" });
    expect(revoke).toHaveClass("team-action-revoke");
    expect(revoke.textContent?.match(/carlos@real\.test/g)).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Revocar acceso" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Invitar reemplazo administrativo" }));
    expect(screen.getByRole("dialog", { name: "Invitar administrador de reemplazo" })).toBeInTheDocument();
    expect(screen.getByLabelText("Correo electrónico")).toHaveAttribute(
      "placeholder",
      "correo@institucion.com",
    );
    expect(screen.getByText("Administrador institucional")).toBeInTheDocument();
  });
});
