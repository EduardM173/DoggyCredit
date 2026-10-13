import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductsCatalogPanel } from "./ProductsCatalogPanel";
import type { ProductCatalogItem } from "./api";

const mockSampleProducts: ProductCatalogItem[] = [
  {
    id: "prod-1",
    tenantId: "tenant-bank-x",
    name: "Microcrédito Productivo",
    category: "MICRO_CREDIT",
    applicantScope: "PERSON",
    minAmount: 1000,
    maxAmount: 50000,
    maxDebtToIncome: 0.4,
    minMonthlyDisposableIncome: 2500,
    allowsRecentArrears: false,
    active: true,
    purposes: ["WORKING_CAPITAL"],
    createdAt: "2026-10-10T12:00:00Z",
    updatedAt: "2026-10-10T12:00:00Z",
  },
  {
    id: "prod-2",
    tenantId: "tenant-bank-x",
    name: "Línea Pyme Empresarial",
    category: "SME_CREDIT",
    applicantScope: "COMPANY",
    minAmount: 10000,
    maxAmount: 200000,
    maxDebtToIncome: null,
    minMonthlyDisposableIncome: 10000,
    allowsRecentArrears: false,
    active: true,
    purposes: ["EQUIPMENT", "BUSINESS_INVESTMENT"],
    createdAt: "2026-10-10T12:00:00Z",
    updatedAt: "2026-10-10T12:00:00Z",
  },
];

describe("HU-16 ProductsCatalogPanel", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("displays real products of the institution with name, scope and amounts (CA-16.01)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockSampleProducts,
    });

    render(
      <ProductsCatalogPanel
        slug="banco-x"
        tenantName="Banco X"
        admin={true}
      />,
    );

    expect(await screen.findByText("Microcrédito Productivo")).toBeInTheDocument();
    expect(screen.getByText("Línea Pyme Empresarial")).toBeInTheDocument();
    expect(screen.getByText("Bs. 1.000 – Bs. 50.000")).toBeInTheDocument();
    expect(screen.getByText("Bs. 10.000 – Bs. 200.000")).toBeInTheDocument();
    expect(screen.getAllByText("Activo")).toHaveLength(2);
  });

  it("allows Ana (admin) to open modal and create a new product (PA-16.01, CA-16.02)", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSampleProducts,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: "prod-3",
          name: "Crédito Verde Sostenible",
          category: "GREEN_CREDIT",
          applicantScope: "BOTH",
          minAmount: 5000,
          maxAmount: 80000,
          active: true,
          purposes: ["GREEN_PROJECT"],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          ...mockSampleProducts,
          {
            id: "prod-3",
            name: "Crédito Verde Sostenible",
            category: "GREEN_CREDIT",
            applicantScope: "BOTH",
            minAmount: 5000,
            maxAmount: 80000,
            maxDebtToIncome: 0.35,
            minMonthlyDisposableIncome: null,
            allowsRecentArrears: false,
            active: true,
            purposes: ["GREEN_PROJECT"],
            createdAt: "2026-10-11T10:00:00Z",
            updatedAt: "2026-10-11T10:00:00Z",
          },
        ],
      });

    render(
      <ProductsCatalogPanel
        slug="banco-x"
        tenantName="Banco X"
        admin={true}
      />,
    );

    expect(await screen.findByText("Microcrédito Productivo")).toBeInTheDocument();

    const addBtn = screen.getByRole("button", { name: "Agregar producto" });
    fireEvent.click(addBtn);

    expect(screen.getByText("Nuevo producto crediticio")).toBeInTheDocument();

    const nameInput = screen.getByLabelText(/Nombre comercial del producto/);
    fireEvent.change(nameInput, { target: { value: "Crédito Verde Sostenible" } });

    const minInput = screen.getByLabelText(/Monto mínimo/);
    fireEvent.change(minInput, { target: { value: "5000" } });

    const maxInput = screen.getByLabelText(/Monto máximo/);
    fireEvent.change(maxInput, { target: { value: "80000" } });

    const saveBtn = screen.getByRole("button", { name: "Guardar producto" });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/tenants/banco-x/products/catalog"),
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("Crédito Verde Sostenible"),
        }),
      );
    });
  });

  it("prevents incoherent range (maxAmount < minAmount) and preserves valid inputs (PA-16.02, CA-16.03, CA-16.04)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockSampleProducts,
    });

    render(
      <ProductsCatalogPanel
        slug="banco-x"
        tenantName="Banco X"
        admin={true}
      />,
    );

    expect(await screen.findByText("Microcrédito Productivo")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Agregar producto" }));

    const nameInput = screen.getByLabelText(/Nombre comercial del producto/);
    fireEvent.change(nameInput, { target: { value: "Crédito Incoherente" } });

    const minInput = screen.getByLabelText(/Monto mínimo/);
    fireEvent.change(minInput, { target: { value: "10000" } });

    const maxInput = screen.getByLabelText(/Monto máximo/);
    fireEvent.change(maxInput, { target: { value: "5000" } }); // Max < Min!

    fireEvent.click(screen.getByRole("button", { name: "Guardar producto" }));

    expect(
      await screen.findByText("El monto máximo no puede ser inferior al monto mínimo."),
    ).toBeInTheDocument();

    // CA-16.04: Preserves entered valid name
    expect(nameInput).toHaveValue("Crédito Incoherente");
  });

  it("warns when attempting to deactivate the last applicable product for Empresa (PA-16.04, CA-16.08, CA-16.12)", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => mockSampleProducts,
      })
      // Deactivation impact check indicates it's the last product for COMPANY
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          isLastActive: true,
          scope: "COMPANY",
          warningMessage:
            "Este es el único producto activo aplicable a Empresa. Si lo desactivas, tu institución no estará preparada para realizar evaluaciones crediticias empresariales y las nuevas solicitudes para empresas quedarán bloqueadas.",
        }),
      })
      // PATCH call confirming deactivation
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ...mockSampleProducts[1],
          active: false,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [
          mockSampleProducts[0],
          { ...mockSampleProducts[1], active: false },
        ],
      });

    render(
      <ProductsCatalogPanel
        slug="banco-x"
        tenantName="Banco X"
        admin={true}
      />,
    );

    expect(await screen.findByText("Línea Pyme Empresarial")).toBeInTheDocument();

    const deactivateBtn = screen.getByRole("button", {
      name: "Desactivar Línea Pyme Empresarial",
    });
    fireEvent.click(deactivateBtn);

    // Warning confirmation modal appears (PA-16.04)
    expect(
      await screen.findByText("Advertencia de impacto en nuevas evaluaciones"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Este es el único producto activo aplicable a Empresa/,
      ),
    ).toBeInTheDocument();

    // Confirm deactivation
    const confirmBtn = screen.getByRole("button", { name: "Confirmar desactivación" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/tenants/banco-x/products/catalog/prod-2/status"),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ active: false, confirmImpact: true }),
        }),
      );
    });
  });

  it("restricts permissions for Carlos (analyst): shows read-only mode without add/edit buttons (PA-16.05, CA-16.09)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockSampleProducts,
    });

    render(
      <ProductsCatalogPanel
        slug="banco-x"
        tenantName="Banco X"
        admin={false} // Carlos analista!
      />,
    );

    expect(await screen.findByText("Microcrédito Productivo")).toBeInTheDocument();

    // Informative read-only banner visible
    expect(screen.getByRole("status")).toHaveTextContent(
      "Modo de consulta (Analista): Puedes revisar las condiciones",
    );

    // Admin buttons are NOT present
    expect(screen.queryByRole("button", { name: "Agregar producto" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Editar Microcrédito Productivo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Desactivar Microcrédito Productivo" })).not.toBeInTheDocument();
  });
});
