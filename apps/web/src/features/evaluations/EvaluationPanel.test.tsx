import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EvaluationPanel } from "./EvaluationPanel";
import type { InstitutionHome } from "../institution/api";
const home = { tenant: { slug: "banco-x", name: "Banco X" } } as InstitutionHome;
let found: boolean, ready: boolean;
let submission: Record<string, unknown> | undefined;
const fetchMock = vi.fn();
beforeEach(() => {
  found = true;
  ready = true;
  submission = undefined;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
    const body = options?.body ? JSON.parse(String(options.body)) : null;
    let result;
    if (url.endsWith("/preparation")) result = { ready };
    else if (url.endsWith("/lookup"))
      result = {
        found,
        applicant: found
          ? { id: "client-1", name: "María Rojas", documentType: "CI", documentNumber: body.documentNumber }
          : null,
      };
    else if (options?.method === "POST") {
      submission = body;
      result = { id: "case-1" };
    } else
      result = {
        id: "case-1",
        status: "DRAFT",
        purpose: submission?.purpose ?? "WORKING_CAPITAL",
        requestedAmount: submission?.requestedAmount ?? "12000",
        consentGivenAt: "2026-10-06T12:00:00Z",
        applicantSnapshot: { name: "María Rojas", documentType: "CI", documentNumber: "7812456" },
      };
    return { ok: true, status: 200, json: async () => result };
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function mount(path = "/banco-x/evaluaciones/nueva") {
  const routes = [
    { path: "/banco-x/evaluaciones/nueva", element: <EvaluationPanel home={home} /> },
    { path: "/banco-x/evaluaciones/:evaluationId", element: <EvaluationPanel home={home} /> },
  ];
  return createMemoryRouter(routes, { initialEntries: [path] });
}
function start(path?: string) {
  const router = mount(path);
  render(<RouterProvider router={router} />);
  return router;
}
async function identify() {
  const number = await screen.findByLabelText("Número de documento");
  fireEvent.change(number, { target: { value: "7812456" } });
  fireEvent.click(screen.getByRole("button", { name: "Buscar solicitante" }));
}
async function fillNeed() {
  fireEvent.change(screen.getByLabelText("Finalidad del crédito *"), {
    target: { value: "WORKING_CAPITAL" },
  });
  fireEvent.change(screen.getByLabelText("Monto solicitado *"), { target: { value: "12000" } });
  fireEvent.click(screen.getByRole("button", { name: "Revisar evaluación" }));
}
it("PA-10.1/3/4/5 reuses a person, preserves valid values, edits directly and requires consent", async () => {
  const router = start();
  await identify();
  fireEvent.click(await screen.findByRole("button", { name: "Continuar con este solicitante" }));
  expect(screen.queryByLabelText("Nombre(s) *")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Finalidad del crédito *"), {
    target: { value: "WORKING_CAPITAL" },
  });
  fireEvent.change(screen.getByLabelText("Monto solicitado *"), { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Revisar evaluación" }));
  expect(screen.getByText(/Ingresa un monto mayor/)).toBeInTheDocument();
  expect(screen.getByLabelText("Finalidad del crédito *")).toHaveValue("WORKING_CAPITAL");
  fireEvent.change(screen.getByLabelText("Monto solicitado *"), { target: { value: "12000" } });
  fireEvent.click(screen.getByRole("button", { name: "Revisar evaluación" }));
  fireEvent.click(screen.getByRole("button", { name: "Modificar finalidad del crédito" }));
  expect(screen.getByLabelText("Monto solicitado *")).toHaveValue("12000");
  fireEvent.change(screen.getByLabelText("Finalidad del crédito *"), { target: { value: "GREEN_PROJECT" } });
  fireEvent.click(screen.getByRole("button", { name: "Guardar y volver al resumen" }));
  expect(screen.getByRole("heading", { name: "Revisar y autorizar evaluación" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Iniciar evaluación" }));
  expect(screen.getByText("Debes confirmar el consentimiento antes de iniciar.")).toBeInTheDocument();
  expect(submission).toBeUndefined();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Iniciar evaluación" }));
  await screen.findByRole("heading", { name: "Evaluación preparada" });
  expect(submission).toMatchObject({
    clientId: "client-1",
    requestedAmount: "12000",
    purpose: "GREEN_PROJECT",
    consent: true,
  });
  expect(submission?.person).toBeUndefined();
  const savedPath = router.state.location.pathname;
  cleanup();
  start(savedPath);
  await screen.findByRole("heading", { name: "Evaluación preparada" });
});
it("PA-10.2 creates only on final submit, validates minimum data and preserves new applicant on back", async () => {
  found = false;
  start();
  await identify();
  fireEvent.click(await screen.findByRole("button", { name: "Completar datos del solicitante" }));
  fireEvent.change(screen.getByLabelText("Nombre(s) *"), { target: { value: "María" } });
  fireEvent.change(screen.getByLabelText("Apellido(s) *"), { target: { value: "Rojas1" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuar a solicitud crediticia" }));
  expect(screen.getByText("Ingresa apellidos válidos, sin números.")).toBeInTheDocument();
  expect(screen.getByLabelText("Nombre(s) *")).toHaveValue("María");
  fireEvent.change(screen.getByLabelText("Apellido(s) *"), { target: { value: "Rojas" } });
  fireEvent.change(screen.getByLabelText("Fecha de nacimiento *"), { target: { value: "1998-07-14" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuar a solicitud crediticia" }));
  expect(submission).toBeUndefined();
  await fillNeed();
  fireEvent.click(screen.getByRole("button", { name: "Modificar solicitante" }));
  fireEvent.click(screen.getByRole("button", { name: "Completar datos del solicitante" }));
  expect(screen.getByLabelText("Nombre(s) *")).toHaveValue("María");
  fireEvent.click(screen.getByRole("button", { name: "Continuar a solicitud crediticia" }));
  expect(screen.getByRole("heading", { name: "Revisar y autorizar evaluación" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Iniciar evaluación" }));
  await waitFor(() =>
    expect(submission).toMatchObject({
      person: { firstName: "María", lastName: "Rojas", birthDate: "1998-07-14" },
    }),
  );
});
it("invalid documents do not search and PA-10.6 blocks before sensitive fields", async () => {
  start();
  fireEvent.change(await screen.findByLabelText("Número de documento"), { target: { value: "12A-??" } });
  fireEvent.click(screen.getByRole("button", { name: "Buscar solicitante" }));
  expect(screen.getByText(/Ingresa un documento válido/)).toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/lookup"))).toBe(false);
  cleanup();
  ready = false;
  start();
  await screen.findByText("Tu institución todavía no está lista para evaluar");
  expect(screen.queryByLabelText("Número de documento")).not.toBeInTheDocument();
});
it("retains the idempotency key and all answers on a recoverable submit failure", async () => {
  start();
  await identify();
  fireEvent.click(await screen.findByRole("button", { name: "Continuar con este solicitante" }));
  await fillNeed();
  fireEvent.click(screen.getByRole("checkbox"));
  const original = fetchMock.getMockImplementation()!;
  let failedKey: string | undefined;
  fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST" && !url.endsWith("/lookup") && !failedKey) {
      failedKey = JSON.parse(String(options.body)).idempotencyKey;
      throw new TypeError("offline");
    }
    return original(url, options);
  });
  fireEvent.click(screen.getByRole("button", { name: "Iniciar evaluación" }));
  await screen.findByText(/No pudimos confirmar el caso/);
  expect(screen.getByRole("checkbox")).toBeChecked();
  fireEvent.click(screen.getByRole("button", { name: "Iniciar evaluación" }));
  await screen.findByRole("heading", { name: "Evaluación preparada" });
  expect(submission?.idempotencyKey).toBe(failedKey);
});
