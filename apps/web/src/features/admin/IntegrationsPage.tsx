import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { adminApi, AdminError, displayDate, type IntegrationHealthState, type IntegrationListItem } from "./api";
import { IntegrationStatusChip } from "./IntegrationStatusChip";

const filterOptions: { value: "" | IntegrationHealthState; label: string }[] = [
  { value: "", label: "Todos los estados" },
  { value: "DEGRADADO_OBSERVADO", label: "Degradado" },
  { value: "OPERATIVO_OBSERVADO", label: "Operativo" },
  { value: "SIN_SENAL_RECIENTE", label: "Sin señal reciente" },
  { value: "ERROR_MONITOREO", label: "Error de monitoreo" },
];

function affectedText(item: IntegrationListItem) {
  const { known, count } = item.tenants.affected;
  if (!known || count === null) return "Sin datos";
  return count === 0 ? "Ninguna" : String(count);
}

export function IntegrationsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const estado = params.get("estado") ?? "";
  const [items, setItems] = useState<IntegrationListItem[] | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof AdminError && e.status === 401) navigate("/admin/login", { replace: true });
      else setError(e instanceof Error ? e.message : "No se pudo cargar el estado de las integraciones.");
    },
    [navigate],
  );

  useEffect(() => {
    const controller = new AbortController();
    adminApi<IntegrationListItem[]>("/platform/integrations", { signal: controller.signal })
      .then((result) => !controller.signal.aborted && setItems(result))
      .catch((e: unknown) => !controller.signal.aborted && fail(e));
    return () => controller.abort();
  }, [fail, attempt]);

  function changeFilter(value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set("estado", value);
    else next.delete("estado");
    setParams(next, { replace: true });
  }

  const visible = items?.filter((item) => !estado || item.health.state === estado) ?? [];
  const search = params.toString() ? `?${params.toString()}` : "";

  return (
    <>
      <div className="admin-page-heading">
        <h1>Integraciones</h1>
        <p>
          Salud observada de los proveedores a partir de las consultas recientes. Es el estado visto por esta
          instancia de la API y no reemplaza la habilitación global ni la de cada institución.
        </p>
      </div>

      {error && (
        <div className="admin-alert" role="alert">
          <p>{error}</p>
          <button className="button button-outline" onClick={() => setAttempt(attempt + 1)}>
            Reintentar
          </button>
        </div>
      )}
      {!items && !error && <p role="status">Cargando integraciones...</p>}

      {items && (
        <>
          <div className="integration-toolbar">
            <label>
              Estado
              <select value={estado} onChange={(event) => changeFilter(event.target.value)}>
                {filterOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="button button-outline" onClick={() => setAttempt(attempt + 1)}>
              Actualizar
            </button>
          </div>

          {items.length === 0 ? (
            <p role="status">No hay proveedores registrados en la plataforma.</p>
          ) : visible.length === 0 ? (
            <p role="status">
              Ningún proveedor coincide con este filtro.{" "}
              <button className="button button-outline" onClick={() => changeFilter("")}>
                Limpiar filtro
              </button>
            </p>
          ) : (
            <div className="integration-table-wrap">
              <table className="integration-table">
                <thead>
                  <tr>
                    <th scope="col">Proveedor</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Última señal</th>
                    <th scope="col">Instituciones afectadas</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((item) => (
                    <tr key={item.code}>
                      <th scope="row">
                        <Link to={`/admin/integraciones/${item.code}${search}`}>{item.name}</Link>
                        {!item.globallyEnabled && <small> · Deshabilitado globalmente</small>}
                      </th>
                      <td>
                        <IntegrationStatusChip state={item.health.state} />
                        {item.health.state === "OPERATIVO_OBSERVADO" && item.health.confidence === "LOW" && (
                          <small className="integration-note">Pocas consultas recientes</small>
                        )}
                      </td>
                      <td>
                        {item.health.lastSignalAt ? displayDate(item.health.lastSignalAt) : "Sin señal"}
                      </td>
                      <td>{affectedText(item)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}