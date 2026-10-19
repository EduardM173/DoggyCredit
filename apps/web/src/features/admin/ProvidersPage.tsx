import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { adminApi, AdminError, displayDate, type ProviderAdminView } from "./api";

const healthLabels: Record<ProviderAdminView["health"]["status"], string> = {
  ACTIVE: "Sin incidencias observadas",
  DEGRADED: "Degradado",
  INACTIVE: "Inactivo",
};
const subjectLabels = { PERSON: "Personas", COMPANY: "Empresas (NIT)" } as const;

export function ProvidersPage() {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<ProviderAdminView[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState<{ code: string; enable: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback(
    (e: unknown, fallback: string) => {
      if (e instanceof AdminError && e.status === 401) navigate("/admin/login", { replace: true });
      else setError(e instanceof Error ? e.message : fallback);
    },
    [navigate],
  );

  useEffect(() => {
    const controller = new AbortController();
    adminApi<ProviderAdminView[]>("/platform/providers", { signal: controller.signal })
      .then((result) => !controller.signal.aborted && setProviders(result))
      .catch((e: unknown) => !controller.signal.aborted && fail(e, "No se pudieron cargar los proveedores."));
    return () => controller.abort();
  }, [fail]);

  async function confirm(event: FormEvent<HTMLFormElement>, provider: ProviderAdminView) {
    event.preventDefault();
    if (!pending) return;
    const reason = String(new FormData(event.currentTarget).get("reason") || "").trim();
    setBusy(true);
    setError("");
    try {
      const result = await adminApi<{ provider: ProviderAdminView; changed: boolean }>(
        `/platform/providers/${provider.code}/global-status`,
        { body: { enabled: pending.enable, ...(reason ? { reason } : {}) } },
      );
      setProviders(
        (current) => current?.map((p) => (p.code === provider.code ? result.provider : p)) ?? null,
      );
      setNotice(
        result.changed
          ? `${provider.name}: habilitación global ${pending.enable ? "activada" : "desactivada"}.`
          : `${provider.name} ya estaba en ese estado.`,
      );
      setPending(null);
    } catch (e) {
      fail(e, "No se pudo actualizar el proveedor. Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="admin-page-heading">
        <h1>Proveedores simulados</h1>
        <p>
          Controla si Bank Mock y Buró Mock aceptan nuevas consultas. La habilitación global, la salud
          observada y la habilitación de cada institución son hechos distintos. Las evaluaciones ya realizadas
          no cambian.
        </p>
      </div>
      {error && (
        <p className="admin-alert" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!providers && !error && <p role="status">Cargando proveedores...</p>}
      <div className="provider-grid">
        {providers?.map((provider) => {
          const asking = pending?.code === provider.code ? pending : null;
          return (
            <section
              key={provider.code}
              className="provider-card"
              aria-labelledby={`provider-${provider.code}`}
            >
              <h2 id={`provider-${provider.code}`}>{provider.name}</h2>
              <p>{provider.description}</p>
              {!provider.registered && (
                <p role="alert">
                  Este proveedor no está registrado en la plataforma. No se puede administrar.
                </p>
              )}
              <dl className="provider-facts">
                <div>
                  <dt>Habilitación global</dt>
                  <dd>
                    <span
                      className={`admin-status ${provider.global.enabled ? "activation-ACTIVE" : "activation-SUSPENDED"}`}
                    >
                      {provider.global.enabled ? "Habilitado" : "Deshabilitado"}
                    </span>
                    <small>
                      {provider.global.changedAt
                        ? `Último cambio: ${displayDate(provider.global.changedAt)}`
                        : "Sin cambios registrados"}
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Salud observada</dt>
                  <dd>
                    <span
                      className={`admin-status ${
                        provider.health.status === "ACTIVE" ? "activation-ACTIVE" : "activation-INVITED"
                      }`}
                    >
                      {healthLabels[provider.health.status]}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Instituciones que lo habilitaron</dt>
                  <dd>{provider.tenants.enabled}</dd>
                </div>
                <div>
                  <dt>Cobertura</dt>
                  <dd>{provider.coverage.subjectTypes.map((t) => subjectLabels[t]).join(" y ")}</dd>
                </div>
                <div>
                  <dt>Nuevas consultas</dt>
                  <dd>{provider.acceptsNewQueries ? "Aceptadas" : "No se aceptan"}</dd>
                </div>
              </dl>
              {provider.simulationScenarios && (
                <details>
                  <summary>Escenarios simulados (solo desarrollo y pruebas)</summary>
                  <ul>
                    {provider.simulationScenarios.map((scenario) => (
                      <li key={scenario.status}>
                        <strong>{scenario.status}</strong>: documento terminado en {scenario.documentEnding}.{" "}
                        {scenario.description}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {provider.registered &&
                (asking ? (
                  <form onSubmit={(event) => confirm(event, provider)} className="provider-confirm">
                    <p>
                      {asking.enable
                        ? "Las instituciones volverán a poder consultar este proveedor si lo tienen habilitado."
                        : "Las nuevas evaluaciones dejarán de consultar este proveedor. Las evaluaciones anteriores conservan sus resultados."}
                    </p>
                    <label>
                      Motivo (opcional)
                      <input name="reason" maxLength={200} />
                    </label>
                    <button className="button button-primary" disabled={busy}>
                      {asking.enable ? "Confirmar habilitación" : "Confirmar deshabilitación"}
                    </button>
                    <button
                      type="button"
                      className="button button-outline"
                      onClick={() => setPending(null)}
                      disabled={busy}
                    >
                      Cancelar
                    </button>
                  </form>
                ) : (
                  <button
                    className="button button-outline"
                    onClick={() => {
                      setNotice("");
                      setPending({ code: provider.code, enable: !provider.global.enabled });
                    }}
                  >
                    {provider.global.enabled ? "Deshabilitar globalmente" : "Habilitar globalmente"}
                  </button>
                ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
