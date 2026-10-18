import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvaluationReadiness } from "./api";
import { EvaluationWizard } from "./EvaluationWizard";

const jsonResponse = (data: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  });

const BURO_ONLY_REASON = "El Buró habilitado solo cubre personas. Habilita el Banco para evaluar empresas.";

function readinessWith(company: { supported: boolean; reason?: string }): EvaluationReadiness {
  return {
    ready: true,
    completed: 3,
    percentage: 100,
    steps: { institution: true, source: true, products: true },
    tenantName: "Banco del Sol",
    supportedApplicantTypes: {
      PERSON: { supported: true },
      COMPANY: company,
    },
  };
}

function renderWizard(props: { ready?: boolean; initialReadiness?: EvaluationReadiness } = {}) {
  return render(
    <MemoryRouter>
      <EvaluationWizard
        slug="banco-sol"
        tenantName="Banco del Sol"
        ready={props.ready ?? true}
        initialReadiness={props.initialReadiness}
      />
    </MemoryRouter>,
  );
}

describe("S4-HF-07 EvaluationWizard - bloquear antes de capturar datos", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("HF-07/UI-1: empresa sin cobertura muestra el motivo, oculta el formulario y no llama al API", () => {
    renderWizard({
      initialReadiness: readinessWith({ supported: false, reason: BURO_ONLY_REASON }),
    });

    // La etiqueta ya avisa antes de elegir la opción.
    expect(screen.getByText("No disponible")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Empresa/i }));

    expect(screen.getByText("Evaluación empresarial no disponible")).toBeInTheDocument();
    expect(screen.getByText(BURO_ONLY_REASON)).toBeInTheDocument();

    // No se puede capturar nada: ni NIT, ni búsqueda, ni continuar.
    expect(screen.queryByLabelText(/Número de Identificación Tributaria/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Buscar/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continuar a Solicitud/i })).toBeDisabled();

    // Intentar continuar no dispara ninguna petición (ni búsqueda ni borrador).
    fireEvent.click(screen.getByRole("button", { name: /Continuar a Solicitud/i }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("HF-07/UI-2: sin motivo del servidor usa el mensaje por defecto", () => {
    renderWizard({ initialReadiness: readinessWith({ supported: false }) });

    fireEvent.click(screen.getByRole("button", { name: /^Empresa/i }));

    expect(screen.getByText("Evaluación empresarial no disponible")).toBeInTheDocument();
    expect(
      screen.getByText(/no cuenta con productos crediticios activos para empresas/i),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText(/Número de Identificación Tributaria/i)).not.toBeInTheDocument();
  });

  it("HF-07/UI-3: lee la cobertura desde el readiness del servidor cuando no se entrega inicial", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/evaluations/readiness")) {
        return jsonResponse(readinessWith({ supported: false, reason: BURO_ONLY_REASON }));
      }
      return jsonResponse({});
    });

    renderWizard();

    // Espera a que el readiness cargue y marque la empresa como no disponible.
    expect(await screen.findByText("No disponible")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Empresa/i }));

    expect(screen.getByText(BURO_ONLY_REASON)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Número de Identificación Tributaria/i)).not.toBeInTheDocument();

    // Solo se consultó el readiness; no hubo POST de borrador.
    const posts = fetchMock.mock.calls.filter(([, options]) => options?.method === "POST");
    expect(posts).toHaveLength(0);
  });

  it("HF-07/UI-4: persona sigue habilitada y crea borrador con CI cuando la empresa está bloqueada", async () => {
    let capturedPayload: Record<string, unknown> | null = null;

    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      if (typeof url === "string" && url.includes("/clients/search")) {
        return jsonResponse(null);
      }
      if (options?.method === "POST") {
        capturedPayload = JSON.parse(options.body as string) as Record<string, unknown>;
        return jsonResponse({
          id: "eval-person-1",
          tenantId: "tenant-1",
          clientName: "Carlos Perez",
          documentNumber: "1234567",
          purpose: "WORKING_CAPITAL",
          requestedAmount: 10000,
          status: "DRAFT",
        });
      }
      return jsonResponse({});
    });

    renderWizard({
      initialReadiness: readinessWith({ supported: false, reason: BURO_ONLY_REASON }),
    });

    fireEvent.change(screen.getByLabelText(/Documento de identidad/i), {
      target: { value: "1234567" },
    });
    expect(screen.getByRole("button", { name: /Buscar/i })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Buscar/i }));

    const nameInput = await screen.findByLabelText(/Nombre completo del solicitante/i);
    fireEvent.change(nameInput, { target: { value: "Carlos Perez" } });

    fireEvent.click(screen.getByRole("button", { name: /Continuar a Solicitud/i }));
    fireEvent.click(screen.getByRole("button", { name: /Revisar e Iniciar/i }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /Iniciar evaluación/i }));

    await screen.findByText("Evaluación preparada exitosamente");
    expect(capturedPayload).toEqual(
      expect.objectContaining({
        clientType: "PERSON",
        documentType: "CI",
        documentNumber: "1234567",
        name: "Carlos Perez",
      }),
    );
    expect(capturedPayload).not.toHaveProperty("economicActivity");
  });

  it("HF-07/UI-5: al volver de Empresa bloqueada a Persona el formulario reaparece", () => {
    renderWizard({
      initialReadiness: readinessWith({ supported: false, reason: BURO_ONLY_REASON }),
    });

    fireEvent.click(screen.getByRole("button", { name: /^Empresa/i }));
    expect(screen.queryByLabelText(/Documento de identidad/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Persona/i }));

    expect(screen.getByLabelText(/Documento de identidad/i)).toBeInTheDocument();
    expect(screen.queryByText("Evaluación empresarial no disponible")).not.toBeInTheDocument();
  });

  it("HF-07/UI-6: institución no preparada bloquea persona y empresa antes de capturar datos", () => {
    renderWizard({ ready: false });

    expect(screen.getByText("Institución pendiente de preparación")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: /Tipo de solicitante/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Documento de identidad/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Número de Identificación Tributaria/i)).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
