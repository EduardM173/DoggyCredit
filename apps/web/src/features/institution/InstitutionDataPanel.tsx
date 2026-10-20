import { useEffect, useState } from "react";
import { Info, Lock } from "lucide-react";
import { institutionApi, InstitutionError } from "./api";
import "./institution.css";

export type InstitutionDataField = {
  key: string;
  label: string;
  value: string | null;
  provenance: string;
  editable: boolean;
};

export type InstitutionData = {
  tenantSlug: string;
  fields: InstitutionDataField[];
  supportMessage: string;
};

type EditableKey =
  | "publicAddress"
  | "contactPhone"
  | "contactEmail"
  | "supportPhone"
  | "supportEmail";

const FIELD_LABELS: Record<EditableKey, { label: string; max: number; type: string }> = {
  publicAddress: { label: "Dirección pública", max: 240, type: "text" },
  contactPhone: { label: "Teléfono de contacto visible", max: 40, type: "tel" },
  contactEmail: { label: "Correo de contacto visible", max: 254, type: "email" },
  supportPhone: { label: "Teléfono de soporte", max: 40, type: "tel" },
  supportEmail: { label: "Correo de soporte", max: 254, type: "email" },
};

function valuesFrom(data: InstitutionData): Record<EditableKey, string> {
  const find = (key: EditableKey) => data.fields.find((field) => field.key === key)?.value ?? "";
  return {
    publicAddress: find("publicAddress"),
    contactPhone: find("contactPhone"),
    contactEmail: find("contactEmail"),
    supportPhone: find("supportPhone"),
    supportEmail: find("supportEmail"),
  };
}

export function InstitutionDataPanel({
  slug,
  admin,
  tenantName,
}: {
  slug: string;
  admin: boolean;
  tenantName: string;
}) {
  const [data, setData] = useState<InstitutionData | null>(null);
  const [values, setValues] = useState<Record<EditableKey, string>>({
    publicAddress: "",
    contactPhone: "",
    contactEmail: "",
    supportPhone: "",
    supportEmail: "",
  });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    institutionApi<InstitutionData>(`/tenants/${encodeURIComponent(slug)}/institution-data`, {
      signal: controller.signal,
    })
      .then((value) => {
        setData(value);
        setValues(valuesFrom(value));
        setError("");
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setData(null);
        setError(
          reason instanceof Error
            ? reason.message
            : "No se pudieron cargar los datos institucionales.",
        );
      });
    return () => controller.abort();
  }, [slug]);

  function update(key: EditableKey, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setSuccess("");
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const value = await institutionApi<InstitutionData>(
        `/tenants/${encodeURIComponent(slug)}/institution-data`,
        { method: "PATCH", body: values },
      );
      setData(value);
      setValues(valuesFrom(value));
      setSuccess("Datos institucionales actualizados.");
    } catch (reason) {
      setError(
        reason instanceof InstitutionError && reason.status === 403
          ? "Solo un administrador institucional puede actualizar estos datos."
          : reason instanceof Error
            ? reason.message
            : "No se pudieron guardar los cambios. Intenta nuevamente.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (!data)
    return (
      <main className="institution-dashboard" aria-label="Datos institucionales">
        {error ? (
          <p role="alert" className="institution-error institution-page-error">
            {error}
          </p>
        ) : (
          <p role="status">Cargando datos institucionales...</p>
        )}
      </main>
    );

  const locked = data.fields.filter((field) => !field.editable);
  const editable = data.fields.filter((field) => field.editable);

  return (
    <main className="institution-dashboard" aria-label="Datos institucionales">
      <p className="institution-eyebrow">DATOS INSTITUCIONALES</p>
      <h1>Datos de {tenantName}</h1>
      <p className="institution-lead">
        Revisa la información registrada y actualiza los datos de contacto permitidos.
      </p>

      <section className="institution-home-panel institution-detail-panel" aria-label="Datos no editables">
        <h2>Datos legales y contractuales</h2>
        <p className="institution-note">
          <Lock size={18} />
          {data.supportMessage}
        </p>
        {locked.map((field) => (
          <div className="institution-field" key={field.key}>
            <strong>{field.label}</strong>
            <span>{field.value ?? "Sin registrar"}</span>
            <small>
              Solo lectura · {field.provenance}
            </small>
          </div>
        ))}
      </section>

      <section className="institution-home-panel institution-detail-panel" aria-label="Datos editables">
        <h2>Datos de contacto editables</h2>
        {editable.map((field) => {
          const key = field.key as EditableKey;
          const meta = FIELD_LABELS[key];
          return (
            <div className="institution-field" key={field.key}>
              <label htmlFor={`institution-data-${key}`}>{meta.label}</label>
              <input
                id={`institution-data-${key}`}
                type={meta.type}
                value={values[key]}
                maxLength={meta.max}
                onChange={(event) => update(key, event.target.value)}
                disabled={!admin || busy}
              />
              <small>{field.provenance}</small>
            </div>
          );
        })}
        {!admin && (
          <p className="institution-note" role="alert">
            <Info size={18} />
            Solo un administrador institucional puede editar estos datos.
          </p>
        )}
        {admin && (
          <div className="institution-actionbar-buttons">
            <button className="institution-primary" disabled={busy} onClick={save}>
              {busy ? "Guardando..." : "Guardar cambios"}
            </button>
          </div>
        )}
        <p className="institution-note">
          <Info size={18} />
          {data.supportMessage}
        </p>
      </section>

      {error && (
        <p role="alert" className="institution-error institution-page-error">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="institution-success">
          {success}
        </p>
      )}
    </main>
  );
}
