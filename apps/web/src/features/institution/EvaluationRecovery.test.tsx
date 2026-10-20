import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluationDetail } from "./EvaluationDetail";
import { nextPollDelay, statusAnnouncement } from "./evaluationRecovery";

vi.mock("./IntegrationNotice", () => ({ IntegrationNotice: () => null }));

const jsonResponse = (data: unknown, status = 200) =>
  Promise.resolve({ ok: status >= 200 && status < 300, status, json: async () => data });

const base = {
  id: "eval-200",
  tenantId: "tenant-1",
  clientId: "client-1",
  clientName: "Maria Lopez",
  documentType: "CI",
  documentNumber: "7891234",
  purpose: "WORKING_CAPITAL",
  requestedAmount: 15000,
  status: "DRAFT",
  consentGivenAt: "2026-10-10T20:00:00.000Z",
  applicantSnapshot: {},
  ruleVersion: "1.0.0",
  createdAt: "2026-10-10T20:00:00.000Z",
  failureCode: null,
  failureMessage: null,
  startedAt: null,
  completedAt: null,
  profile: null,
  sourceResults: [] as unknown[],
  recommendations: [] as unknown[],
};

const partial = {
  ...base,
  status: "INCOMPLETE",
  failureCode: "PARTIAL_SOURCE_FAILURE",
  sourceResults: [
    { id: "sr-1", providerId: "p-bank", providerCode: "BANK_MOCK", providerName: "Banco Mock", status: "SUCCESS", attemptCount: 1, externalReference: null, errorCode: null, requestedAt: "2026-10-10T20:04:00.000Z", respondedAt: "2026-10-10T20:05:00.000Z" },
    { id: "sr-2", providerId: "p-bureau", providerCode: "BUREAU_MOCK", providerName: "Buró crediticio", status: "UNAVAILABLE", attemptCount: 1, externalReference: null, errorCode: "CIRCUIT_OPEN", requestedAt: "2026-10-10T20:04:00.000Z", respondedAt: "2026-10-10T20:05:00.000Z" },
  ],
  tracking: "PROVIDER_ISSUE",
  retry: { allowed: true, reason: "Puedes reintentar la consulta faltante.", remainingAttempts: 3, maxAttempts: 3 },
  coverage: {
    achieved: "Banco Mock aportó datos.",
    missing: "Buró crediticio no respondió por ahora.",
    nextAction: "Puedes reintentar esa consulta.",
  },
  sourceStatuses: [
    { providerCode: "BANK_MOCK", providerName: "Banco Mock", status: "SUCCESS", errorCode: null, asOf: "2026-10-10T20:05:00.000Z" },
    { providerCode: "BUREAU_MOCK", providerName: "Buró crediticio", status: "UNAVAILABLE", errorCode: "CIRCUIT_OPEN", asOf: "2026-10-10T20:05:00.000Z" },
  ],
};

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={["/banco-demo/evaluaciones/eval-200"]}>
      <Routes>
        <Route path="/:tenantSlug/evaluaciones/:id" element={<EvaluationDetail slug="banco-demo" />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("HU-25 EvaluationDetail: recuperación ante fallo de fuentes", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resultado parcial: dice qué se logró, qué faltó y qué hacer, sin términos engañosos", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(partial));
    renderDetail();
    expect(await screen.findByText("Resultado parcial: faltó una fuente")).toBeInTheDocument();
    expect(screen.getByText(/Banco Mock aportó datos\. Buró crediticio no respondió por ahora\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reintentar consulta/ })).toBeEnabled();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/rechazad|deuda cero|sin deuda|en unos minutos/i);
  });

  it("muestra procedencia y fecha de cada fuente", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(partial));
    renderDetail();
    await screen.findByText("Resultado parcial: faltó una fuente");
    expect(document.querySelectorAll(".eval-source-date").length).toBe(2);
  });

  it("doble clic en Reintentar envía una sola llamada a /retry", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(partial));
    let release: (value: unknown) => void = () => {};
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    renderDetail();
    const button = await screen.findByRole("button", { name: /Reintentar consulta/ });
    fireEvent.click(button);
    fireEvent.click(button);
    const retryCalls = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/evaluations/eval-200/retry"));
    expect(retryCalls).toHaveLength(1);
    expect(retryCalls[0][1]).toEqual(expect.objectContaining({ method: "POST" }));
    await act(async () => {
      release(await jsonResponse({ ...base, status: "COMPLETED", tracking: "FINAL" }));
    });
  });

  it("Reintentar queda deshabilitado con el motivo visible cuando el backend no lo permite", async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse({
        ...partial,
        tracking: "FINAL",
        retry: { allowed: false, reason: "Se alcanzó el máximo de reconsultas de esta evaluación.", remainingAttempts: 0, maxAttempts: 3 },
      }),
    );
    renderDetail();
    const button = await screen.findByRole("button", { name: /Reintentar consulta/ });
    expect(button).toBeDisabled();
    expect(screen.getAllByText("Se alcanzó el máximo de reconsultas de esta evaluación.").length).toBeGreaterThan(0);
  });

  it("FAILED por proveedor muestra servicio no disponible y permite reintentar", async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse({
        ...partial,
        status: "FAILED",
        failureCode: "BANK_UNAVAILABLE",
        coverage: { achieved: "Aún no hay datos de fuentes.", missing: "Banco Mock no respondió por ahora.", nextAction: "Puedes reintentar esa consulta." },
      }),
    );
    renderDetail();
    expect(await screen.findByText("Servicio no disponible temporalmente")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reintentar consulta/ })).toBeEnabled();
  });

  it("PROGRESS_STALLED avisa la demora y ofrece Actualizar estado", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ ...base, status: "IN_PROGRESS", tracking: "PROGRESS_STALLED" }));
    renderDetail();
    expect(await screen.findByText("La consulta se está demorando")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Actualizar estado/ })).toBeInTheDocument();
  });

  it("recarga con id en la URL recupera el estado sin llamar a /process", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ ...base, status: "IN_PROGRESS", tracking: "ACTIVE_WAIT" }));
    renderDetail();
    expect(await screen.findByText("Consultando fuentes")).toBeInTheDocument();
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.some((u) => u.endsWith("/process"))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("IN_PROGRESS consulta con espera creciente y se detiene al llegar a un estado final", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fetchMock.mockReturnValueOnce(jsonResponse({ ...base, status: "IN_PROGRESS", tracking: "ACTIVE_WAIT" }));
    fetchMock.mockReturnValueOnce(jsonResponse({ ...base, status: "COMPLETED", tracking: "FINAL" }));
    renderDetail();
    await screen.findByText("Consultando fuentes");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(nextPollDelay(0) + 50);
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("región aria-live polite refleja el estado persistido", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(partial));
    renderDetail();
    await screen.findByText("Resultado parcial: faltó una fuente");
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live).toHaveTextContent(statusAnnouncement("INCOMPLETE", "PROVIDER_ISSUE"));
  });

  it("la espera crece y tiene tope", () => {
    expect(nextPollDelay(0)).toBeLessThan(nextPollDelay(1));
    expect(nextPollDelay(99)).toBe(nextPollDelay(50));
  });
});
