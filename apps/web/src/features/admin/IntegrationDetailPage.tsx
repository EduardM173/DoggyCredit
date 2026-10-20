import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { adminApi, AdminError, displayDate, type IntegrationDetail } from "./api";
import { IntegrationStatusChip } from "./IntegrationStatusChip";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function IntegrationDetailPage() {
  const { code = "" } = useParams();
  const { search } = useLocation();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<IntegrationDetail | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof AdminError && e.status === 401) navigate("/admin/login", { replace: true });
      else if (e instanceof AdminError && e.status === 404) setError("Este proveedor no existe o no está registrado.");
      else setError(e instanceof Error ? e.message : "No se pudo cargar el detalle del proveedor.");
    },
    [navigate],
  );

  useEffect(() => {
    const controller = new AbortController();
    adminApi<IntegrationDetail>(`/platform/integrations/${encodeURIComponent(code)}`, {
      signal: controller.signal,
    })
      .then((result) => !controller.signal.aborted && setDetail(result))
      .catch((e: unknown) => !controller.signal.aborted && fail(e));
    return () => controller.abort();
  }, [code, fail, attempt]);

  const affected = detail?.tenants.affected;

  return (
    <>
      <p>
        <Link to={`/admin/integraciones${search}`}>
          <ArrowLeft size={18} aria-hidden="true" /> Volver a Integraciones
        </Link>
      </p>

      {error && (
        <div className="admin-alert" role="alert">
          <p>{error}</p>
          <button className="button button-outline" onClick={() => setAttempt(attempt + 1)}>
            Reintentar
          </button>
        </div>
      )}
      {!detail && !error && <p role="status">Cargando detalle...</p>}

      {detail && (
        <>
          <div className="admin-page-heading">
            <h1>{detail.name}</h1>
            <IntegrationStatusChip state={detail.health.state} />
          </div>

          <section className="provider-card" aria-labelledby="integration-summary">
            <h2 id="integration-summary">Qué está pasando</h2>
            <p>{detail.health.explanation}</p>
            <p>
              <strong>Siguiente paso:</strong> {detail.health.nextStep}
            </p>
            {detail.episode && (
              <p role="status">
                Episodio abierto desde {displayDate(detail.episode.startedAt)}. Se cierra solo cuando el
                proveedor responde con normalidad.
              </p>
            )}
          </section>

          <section className="provider-card" aria-labelledby="integration-facts">
            <h2 id="integration-facts">Datos observados</h2>
            <dl className="provider-facts">
              <Fact label="Última señal">
                {detail.health.lastSignalAt ? displayDate(detail.health.lastSignalAt) : "Sin señal"}
              </Fact>
              {detail.health.windowStart && detail.health.windowEnd && (
                <Fact label="Ventana observada">
                  {displayDate(detail.health.windowStart)} a {displayDate(detail.health.windowEnd)}
                </Fact>
              )}
                <Fact label="Confianza">
                {detail.health.state === "SIN_SENAL_RECIENTE"
                  ? "No aplica (sin señal)"
                  : detail.health.confidence === "LOW"
                    ? "Baja (pocas consultas recientes)"
                    : "Alta"}
              </Fact>
              <Fact label="Protección temporal">{detail.protection.label}</Fact>
              <Fact label="Habilitación global">
                {detail.globallyEnabled ? "Habilitado" : "Deshabilitado"}
              </Fact>
              <Fact label="Instituciones que lo habilitaron">{detail.tenants.enabled}</Fact>
              <Fact label="Instituciones afectadas">
                {!affected?.known || affected.count === null
                  ? "Sin datos"
                  : affected.count === 0
                    ? "Ninguna"
                    : affected.count}
              </Fact>
            </dl>
            {detail.affectedTenants.length > 0 && (
              <>
                <h3>Instituciones con fallos recientes</h3>
                <ul>
                  {detail.affectedTenants.map((tenant) => (
                    <li key={tenant.name}>{tenant.name}</li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <details className="provider-card">
            <summary>Información avanzada</summary>
            <p>
              {detail.advanced.scope === "INSTANCIA_API"
                ? "Estado observado por esta instancia de la API. Si hay varias instancias, cada una puede ver un estado distinto."
                : detail.advanced.scope}
            </p>
            <dl className="provider-facts">
              <Fact label="Estado del interruptor">{detail.advanced.breakerState}</Fact>
              <Fact label="Motivo">{detail.advanced.reasonCode}</Fact>
              <Fact label="Consultas observadas">{detail.advanced.samples}</Fact>
              <Fact label="Consultas con fallo">{detail.advanced.failures}</Fact>
            </dl>
          </details>

          <button className="button button-outline" onClick={() => setAttempt(attempt + 1)}>
            Actualizar
          </button>
        </>
      )}
    </>
  );
}