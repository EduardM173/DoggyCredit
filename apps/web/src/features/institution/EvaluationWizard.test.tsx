import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvaluationWizard } from "./EvaluationWizard";

const jsonResponse = (data: unknown, status = 200) =>
  Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  });

describe("HU-10 EvaluationWizard", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("warns when institution is not prepared and does not allow evaluation", () => {
    render(
      <MemoryRouter>
        <EvaluationWizard slug="banco-sol" tenantName="Banco del Sol" ready={false} />
      </MemoryRouter>,
    );

    expect(screen.getByText("Institución pendiente de preparación")).toBeInTheDocument();
    expect(
      screen.getByText(/debe completar su preparación institucional/i),
    ).toBeInTheDocument();
  });

  it("searches existing client and preserves data across steps to create draft evaluation", async () => {
    const existingClient = {
      id: "client-1",
      name: "Maria Gonzales",
      documentType: "CI",
      documentNumber: "4567890",
      type: "PERSON",
      economicActivity: "Comercio",
    };

    const createdEval = {
      id: "eval-123",
      tenantId: "tenant-1",
      clientId: "client-1",
      clientName: "Maria Gonzales",
      documentType: "CI",
      documentNumber: "4567890",
      purpose: "WORKING_CAPITAL",
      requestedAmount: 15000,
      status: "DRAFT",
      consentGivenAt: "2026-10-10T12:00:00Z",
      applicantSnapshot: { name: "Maria Gonzales", documentNumber: "4567890" },
      ruleVersion: "1.0.0",
      createdAt: "2026-10-10T12:00:00Z",
    };

    fetchMock.mockImplementation((url: string, options?: RequestInit) => {
      if (typeof url === "string" && url.includes("/clients/search")) {
        return jsonResponse(existingClient);
      }
      if (options?.method === "POST" && typeof url === "string" && url.includes("/evaluaciones")) {
        return jsonResponse(createdEval);
      }
      return jsonResponse({});
    });

    render(
      <MemoryRouter>
        <EvaluationWizard slug="banco-sol" tenantName="Banco del Sol" ready={true} />
      </MemoryRouter>,
    );

    // Step 1: Document input & search
    expect(screen.getByText("Paso 1: Identificación del solicitante")).toBeInTheDocument();
    const docInput = screen.getByLabelText(/Documento de identidad/i);
    fireEvent.change(docInput, { target: { value: "4567890" } });

    const searchBtn = screen.getByRole("button", { name: /Buscar/i });
    fireEvent.click(searchBtn);

    await screen.findByText("Expediente existente encontrado");
    expect(screen.getByText(/Maria Gonzales/)).toBeInTheDocument();

    // Advance to Step 2
    const nextBtn1 = screen.getByRole("button", { name: /Continuar a Solicitud/i });
    fireEvent.click(nextBtn1);

    // Step 2: Solicitud crediticia
    expect(screen.getByText("Paso 2: Solicitud crediticia")).toBeInTheDocument();
    const amountInput = screen.getByLabelText(/Monto solicitado/i);
    fireEvent.change(amountInput, { target: { value: "15000" } });

    const nextBtn2 = screen.getByRole("button", { name: /Revisar e Iniciar/i });
    fireEvent.click(nextBtn2);

    // Step 3: Revisar e Iniciar
    expect(screen.getByText("Paso 3: Revisar e iniciar evaluación")).toBeInTheDocument();
    expect(screen.getByText("Maria Gonzales")).toBeInTheDocument();
    expect(screen.getByText("4567890")).toBeInTheDocument();
    expect(screen.getByText(/15[.,]000/)).toBeInTheDocument();

    // Submit requires consent
    const submitBtn = screen.getByRole("button", { name: /Iniciar evaluación/i });
    expect(submitBtn).toBeDisabled();

    // Toggle consent
    const consentCheckbox = screen.getByRole("checkbox");
    fireEvent.click(consentCheckbox);
    expect(submitBtn).not.toBeDisabled();

    // Confirm evaluation
    fireEvent.click(submitBtn);

    await screen.findByText("Evaluación preparada exitosamente");
    expect(screen.getByText("CASO CREADO EN BORRADOR")).toBeInTheDocument();
  });
});
