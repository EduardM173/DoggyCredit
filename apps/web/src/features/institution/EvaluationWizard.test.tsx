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

  describe("HU-14 EvaluationWizard - Company evaluations", () => {
    it("PA-14.01: evaluates company with existing dossier, tailored review and company consent", async () => {
      const existingCompany = {
        id: "comp-1",
        name: "Tecnología Los Andes S.R.L.",
        documentType: "NIT",
        documentNumber: "1020304050",
        type: "COMPANY",
        economicActivity: "Servicios de Software",
      };

      const createdCompanyEval = {
        id: "eval-comp-99",
        tenantId: "tenant-1",
        clientId: "comp-1",
        clientName: "Tecnología Los Andes S.R.L.",
        documentType: "NIT",
        documentNumber: "1020304050",
        purpose: "WORKING_CAPITAL",
        requestedAmount: 50000,
        status: "DRAFT",
        consentGivenAt: "2026-10-10T12:00:00Z",
        applicantSnapshot: {
          name: "Tecnología Los Andes S.R.L.",
          documentNumber: "1020304050",
          type: "COMPANY",
        },
        ruleVersion: "1.0.0",
        createdAt: "2026-10-10T12:00:00Z",
      };

      let capturedPayload: unknown = null;

      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (typeof url === "string" && url.includes("/evaluations/readiness")) {
          return jsonResponse({
            ready: true,
            supportedApplicantTypes: {
              PERSON: { supported: true },
              COMPANY: { supported: true },
            },
          });
        }
        if (typeof url === "string" && url.includes("/clients/search")) {
          return jsonResponse(existingCompany);
        }
        if (options?.method === "POST" && typeof url === "string" && (url.includes("/evaluations") || url.includes("/evaluaciones"))) {
          capturedPayload = JSON.parse(options.body as string);
          return jsonResponse(createdCompanyEval);
        }
        return jsonResponse({});
      });

      render(
        <MemoryRouter>
          <EvaluationWizard slug="banco-sol" tenantName="Banco del Sol" ready={true} />
        </MemoryRouter>,
      );

      // Select Empresa
      const companyOption = screen.getByRole("button", { name: /Empresa/i });
      fireEvent.click(companyOption);

      // Verify label changed to NIT
      const nitInput = screen.getByLabelText(/Número de Identificación Tributaria/i);
      fireEvent.change(nitInput, { target: { value: "1020304050" } });

      const searchBtn = screen.getByRole("button", { name: /Buscar/i });
      fireEvent.click(searchBtn);

      await screen.findByText("Expediente empresarial existente encontrado");
      expect(screen.getByText(/Tecnología Los Andes S.R.L./)).toBeInTheDocument();

      // Advance to Step 2
      fireEvent.click(screen.getByRole("button", { name: /Continuar a Solicitud/i }));

      // Step 2: Solicitud
      const amountInput = screen.getByLabelText(/Monto solicitado/i);
      fireEvent.change(amountInput, { target: { value: "50000" } });
      fireEvent.click(screen.getByRole("button", { name: /Revisar e Iniciar/i }));

      // Step 3: Review
      expect(screen.getByText("Empresa")).toBeInTheDocument();
      expect(screen.getByText("Tecnología Los Andes S.R.L.")).toBeInTheDocument();
      expect(screen.getByText("1020304050")).toBeInTheDocument();
      expect(screen.getByText("Servicios de Software")).toBeInTheDocument();
      expect(
        screen.getByText(/Autorización institucional de la empresa/),
      ).toBeInTheDocument();

      // Accept consent & submit
      const consentCheckbox = screen.getByRole("checkbox");
      fireEvent.click(consentCheckbox);
      fireEvent.click(screen.getByRole("button", { name: /Iniciar evaluación/i }));

      await screen.findByText("Evaluación preparada exitosamente");
      expect(capturedPayload).toEqual({
        clientType: "COMPANY",
        documentType: "NIT",
        documentNumber: "1020304050",
        name: "Tecnología Los Andes S.R.L.",
        economicActivity: "Servicios de Software",
        purpose: "WORKING_CAPITAL",
        requestedAmount: 50000,
        consentGiven: true,
      });
    });

    it("PA-14.02: captures minimum company fields when no dossier exists", async () => {
      let capturedPayload: Record<string, unknown> | null = null;

      fetchMock.mockImplementation((url: string, options?: RequestInit) => {
        if (typeof url === "string" && url.includes("/evaluations/readiness")) {
          return jsonResponse({
            ready: true,
            supportedApplicantTypes: {
              PERSON: { supported: true },
              COMPANY: { supported: true },
            },
          });
        }
        if (typeof url === "string" && url.includes("/clients/search")) {
          return jsonResponse(null); // Not found
        }
        if (options?.method === "POST" && typeof url === "string" && (url.includes("/evaluations") || url.includes("/evaluaciones"))) {
          capturedPayload = JSON.parse(options.body as string) as Record<string, unknown>;
          return jsonResponse({
            id: "eval-comp-new",
            tenantId: "tenant-1",
            clientName: "Manufactura Andina S.A.",
            documentNumber: "9080706050",
            purpose: "WORKING_CAPITAL",
            requestedAmount: 30000,
            status: "DRAFT",
          });
        }
        return jsonResponse({});
      });

      render(
        <MemoryRouter>
          <EvaluationWizard slug="banco-sol" tenantName="Banco del Sol" ready={true} />
        </MemoryRouter>,
      );

      fireEvent.click(screen.getByRole("button", { name: /Empresa/i }));

      const nitInput = screen.getByLabelText(/Número de Identificación Tributaria/i);
      fireEvent.change(nitInput, { target: { value: "9080706050" } });
      fireEvent.click(screen.getByRole("button", { name: /Buscar/i }));

      // Prompted for minimum fields
      const nameInput = await screen.findByLabelText(/Razón social de la empresa/i);
      fireEvent.change(nameInput, { target: { value: "Manufactura Andina S.A." } });

      const activityInput = screen.getByLabelText(/Actividad económica/i);
      fireEvent.change(activityInput, { target: { value: "Textiles y Calzado" } });

      fireEvent.click(screen.getByRole("button", { name: /Continuar a Solicitud/i }));

      // Step 2 & 3
      fireEvent.click(screen.getByRole("button", { name: /Revisar e Iniciar/i }));

      expect(screen.getByText("Manufactura Andina S.A.")).toBeInTheDocument();
      expect(screen.getByText("Textiles y Calzado")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("checkbox"));
      fireEvent.click(screen.getByRole("button", { name: /Iniciar evaluación/i }));

      await screen.findByText("Evaluación preparada exitosamente");
      expect(capturedPayload).toEqual(
        expect.objectContaining({
          clientType: "COMPANY",
          name: "Manufactura Andina S.A.",
          economicActivity: "Textiles y Calzado",
        }),
      );
    });

    it("PA-14.04: displays restriction alert and prevents form continuation when company coverage is missing", async () => {
      render(
        <MemoryRouter>
          <EvaluationWizard
            slug="banco-sol"
            tenantName="Banco del Sol"
            ready={true}
            initialReadiness={{
              ready: true,
              completed: 3,
              percentage: 100,
              steps: { institution: true, source: true, products: true },
              tenantName: "Banco del Sol",
              supportedApplicantTypes: {
                PERSON: { supported: true },
                COMPANY: {
                  supported: false,
                  reason: "Tu institución no cuenta con productos crediticios activos para empresas. Configura al menos un producto empresarial en la sección de Productos.",
                },
              },
            }}
          />
        </MemoryRouter>,
      );

      // Select Empresa
      fireEvent.click(screen.getByRole("button", { name: /Empresa/i }));

      expect(screen.getByText("Evaluación empresarial no disponible")).toBeInTheDocument();
      expect(
        screen.getByText(/Configura al menos un producto empresarial en la sección de Productos/),
      ).toBeInTheDocument();

      // Continuation button is disabled
      const continueBtn = screen.getByRole("button", { name: /Continuar a Solicitud/i });
      expect(continueBtn).toBeDisabled();
    });

    it("CA-14.08: resets consent checkbox when applicant type is switched", async () => {
      fetchMock.mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("/clients/search")) {
          return jsonResponse(null);
        }
        return jsonResponse({});
      });

      render(
        <MemoryRouter>
          <EvaluationWizard
            slug="banco-sol"
            tenantName="Banco del Sol"
            ready={true}
            initialReadiness={{
              ready: true,
              completed: 3,
              percentage: 100,
              steps: { institution: true, source: true, products: true },
              tenantName: "Banco del Sol",
              supportedApplicantTypes: {
                PERSON: { supported: true },
                COMPANY: { supported: true },
              },
            }}
          />
        </MemoryRouter>,
      );

      // Fill Step 1 for person
      const docInput = screen.getByLabelText(/Documento de identidad/i);
      fireEvent.change(docInput, { target: { value: "1234567" } });
      const searchBtn = screen.getByRole("button", { name: /Buscar/i });
      fireEvent.click(searchBtn);

      // Manual name
      const nameInput = await screen.findByLabelText(/Nombre completo del solicitante/i);
      fireEvent.change(nameInput, { target: { value: "Carlos Perez" } });

      fireEvent.click(screen.getByRole("button", { name: /Continuar a Solicitud/i }));
      fireEvent.click(screen.getByRole("button", { name: /Revisar e Iniciar/i }));

      // Check consent
      const consentCheckbox = screen.getByRole("checkbox");
      fireEvent.click(consentCheckbox);
      expect(consentCheckbox).toBeChecked();

      // Go back to Step 1 via Modificar
      const modifyBtn = screen.getAllByRole("button", { name: /Modificar/i })[0];
      fireEvent.click(modifyBtn);

      // Switch to Empresa
      fireEvent.click(screen.getByRole("button", { name: /Empresa/i }));

      // Fill company info
      const nitInput = screen.getByLabelText(/Número de Identificación Tributaria/i);
      fireEvent.change(nitInput, { target: { value: "99887766" } });
      fireEvent.click(screen.getByRole("button", { name: /Buscar/i }));

      const compNameInput = await screen.findByLabelText(/Razón social de la empresa/i);
      fireEvent.change(compNameInput, { target: { value: "Mi Empresa S.A." } });

      fireEvent.click(screen.getByRole("button", { name: /Continuar a Solicitud/i }));
      fireEvent.click(screen.getByRole("button", { name: /Revisar e Iniciar/i }));

      // Consent must have been reset to unchecked!
      const companyConsentCheckbox = screen.getByRole("checkbox");
      expect(companyConsentCheckbox).not.toBeChecked();
    });
  });
});
