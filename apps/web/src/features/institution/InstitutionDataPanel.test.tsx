import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstitutionDataPanel } from "./InstitutionDataPanel";

const supportMessage =
  "Para solicitar cambios en datos legales o contractuales, contacte a Soporte de Doggy Software.";

const dataResponse = {
  tenantSlug: "banco-x",
  supportMessage,
  fields: [
    { key: "legalName", label: "Razón social", value: "Banco X S.A.", provenance: "Base", editable: false },
    { key: "taxId", label: "NIT", value: "1234567890", provenance: "Base", editable: false },
    { key: "tenantSlug", label: "Identificador", value: "banco-x", provenance: "Plataforma", editable: false },
    {
      key: "contractualResponsible",
      label: "Responsable contractual",
      value: "Ana — Representante",
      provenance: "Solicitud",
      editable: false,
    },
    { key: "publicAddress", label: "Dirección pública", value: "Calle 1", provenance: "Editable", editable: true },
    { key: "contactPhone", label: "Teléfono de contacto visible", value: "+59171234567", provenance: "Editable", editable: true },
    { key: "contactEmail", label: "Correo de contacto visible", value: "a@b.co", provenance: "Editable", editable: true },
    { key: "supportPhone", label: "Teléfono de soporte", value: "", provenance: "Editable", editable: true },
    { key: "supportEmail", label: "Correo de soporte", value: "", provenance: "Editable", editable: true },
  ],
};

describe("HU-34 InstitutionDataPanel", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows editable and blocked fields with provenance and the support message (CA-34.01/CA-34.03)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => dataResponse });

    render(<InstitutionDataPanel slug="banco-x" admin={true} tenantName="Banco X" />);

    expect(await screen.findByText("Datos legales y contractuales")).toBeInTheDocument();
    expect(screen.getByText("1234567890")).toBeInTheDocument();
    expect(screen.getAllByText(supportMessage).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Dirección pública")).toHaveValue("Calle 1");
  });

  it("sends only editable fields on save and shows confirmation (CA-34.02/CA-34.04)", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => dataResponse })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          ...dataResponse,
          fields: dataResponse.fields.map((field) =>
            field.key === "publicAddress" ? { ...field, value: "Calle 9" } : field,
          ),
        }),
      });

    render(<InstitutionDataPanel slug="banco-x" admin={true} tenantName="Banco X" />);
    expect(await screen.findByText("Datos legales y contractuales")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Dirección pública"), { target: { value: "Calle 9" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    await waitFor(() => {
      const call = fetchMock.mock.calls[1];
      expect(String(call[0])).toContain("/tenants/banco-x/institution-data");
      expect(call[1]).toMatchObject({ method: "PATCH" });
      const body = JSON.parse(call[1].body);
      expect(body.publicAddress).toBe("Calle 9");
      expect(body).not.toHaveProperty("taxId");
      expect(body).not.toHaveProperty("legalName");
    });
    expect(await screen.findByText("Datos institucionales actualizados.")).toBeInTheDocument();
  });

  it("lets analysts read but not edit (CA-34.05)", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => dataResponse });

    render(<InstitutionDataPanel slug="banco-x" admin={false} tenantName="Banco X" />);
    expect(await screen.findByText("Datos legales y contractuales")).toBeInTheDocument();

    expect(screen.getByLabelText("Dirección pública")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Guardar cambios" })).not.toBeInTheDocument();
  });

  it("surfaces forbidden responses from the API", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => dataResponse })
      .mockResolvedValueOnce({ ok: false, status: 403, json: async () => ({}) });

    render(<InstitutionDataPanel slug="banco-x" admin={true} tenantName="Banco X" />);
    expect(await screen.findByText("Datos legales y contractuales")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(
      await screen.findByText("Solo un administrador institucional puede actualizar estos datos."),
    ).toBeInTheDocument();
  });
});
