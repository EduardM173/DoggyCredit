import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Filter,
  History,
  Info,
  RotateCcw,
  User,
  XCircle,
} from "lucide-react";
import {
  fetchInstitutionAudit,
  type AuditCategory,
  type AuditEvent,
  type AuditOutcome,
  type AuditPage,
} from "./api";

interface ActivityLogPageProps {
  slug: string;
  tenantName: string;
}

export function ActivityLogPage({ slug, tenantName }: ActivityLogPageProps) {
  const [data, setData] = useState<AuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  // Filtros
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState<AuditCategory | "">("");
  const [outcome, setOutcome] = useState<AuditOutcome | "">("");

  useEffect(() => {
    const controller = new AbortController();

    fetchInstitutionAudit(
      slug,
      {
        page,
        pageSize: 15,
        from: from || undefined,
        to: to || undefined,
        category: category || undefined,
        outcome: outcome || undefined,
      },
      controller.signal,
    )
      .then((res) => {
        if (!controller.signal.aborted) {
          setData(res);
          setLoading(false);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error
            ? err.message
            : "No se pudo cargar el registro de auditoría de la institución.",
        );
        setLoading(false);
      });

    return () => controller.abort();
  }, [slug, page, from, to, category, outcome, reloadKey]);

  const hasActiveFilters = Boolean(from || to || category || outcome);

  const handleResetFilters = () => {
    setFrom("");
    setTo("");
    setCategory("");
    setOutcome("");
    setPage(1);
    setLoading(true);
  };

  const formatTimestamp = (isoDate: string) => {
    try {
      return new Intl.DateTimeFormat("es-BO", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/La_Paz",
      }).format(new Date(isoDate));
    } catch {
      return isoDate;
    }
  };

  return (
    <main className="institution-dashboard activity-dashboard" aria-label="Auditoría y trazabilidad">
      <div className="institution-breadcrumb">
        <Link to={`/${slug}`}>Inicio</Link>
        <ArrowRight size={16} />
        <span>Actividad</span>
      </div>

      <header className="activity-header">
        <p className="institution-eyebrow">AUDITORÍA Y SEGURIDAD</p>
        <h1>Registro de actividad de {tenantName}</h1>
        <p className="institution-lead">
          Historial cronológico inmutable de cambios de configuración, gestión de equipo y evaluaciones crediticias.
        </p>
      </header>

      {/* Barra de Filtros */}
      <section className="activity-filters-card" aria-label="Filtros de actividad">
        <div className="activity-filters-title">
          <Filter size={18} />
          <strong>Filtrar actividad</strong>
        </div>

        <div className="activity-filters-grid">
          <label className="activity-filter-field">
            <span>Desde</span>
            <input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(1);
                setLoading(true);
              }}
              aria-label="Fecha desde"
            />
          </label>

          <label className="activity-filter-field">
            <span>Hasta</span>
            <input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
                setLoading(true);
              }}
              aria-label="Fecha hasta"
            />
          </label>

          <label className="activity-filter-field">
            <span>Categoría</span>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as AuditCategory | "");
                setPage(1);
                setLoading(true);
              }}
              aria-label="Categoría de evento"
            >
              <option value="">Todas las categorías</option>
              <option value="EVALUATION">Evaluaciones crediticias</option>
              <option value="TEAM">Equipo y accesos</option>
              <option value="CATALOG">Catálogo de productos</option>
              <option value="INSTITUTION">Configuración institucional</option>
              <option value="OPERATIONS">Operaciones y planes</option>
            </select>
          </label>

          <label className="activity-filter-field">
            <span>Resultado</span>
            <select
              value={outcome}
              onChange={(e) => {
                setOutcome(e.target.value as AuditOutcome | "");
                setPage(1);
                setLoading(true);
              }}
              aria-label="Resultado"
            >
              <option value="">Todos los resultados</option>
              <option value="SUCCESS">Exitosos</option>
              <option value="FAILURE">Fallidos o alertas</option>
              <option value="INFO">Informativos</option>
            </select>
          </label>

          {hasActiveFilters && (
            <div className="activity-filter-reset">
              <button
                type="button"
                className="activity-button-secondary"
                onClick={handleResetFilters}
              >
                <RotateCcw size={15} />
                Limpiar filtros
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Estados de Carga y Error */}
      {loading && (
        <div className="activity-state-container" role="status">
          <History className="activity-spin" size={32} />
          <p>Cargando registros de auditoría...</p>
        </div>
      )}

      {error && !loading && (
        <div className="activity-error-banner" role="alert">
          <AlertCircle size={24} />
          <div>
            <strong>Error al consultar la auditoría</strong>
            <p>{error}</p>
          </div>
          <button
            type="button"
            className="activity-button-primary"
            onClick={() => {
              setLoading(true);
              setReloadKey((k) => k + 1);
            }}
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Lista de Eventos */}
      {!loading && !error && data && (
        <>
          {data.items.length === 0 ? (
            <div className="activity-empty-state">
              <Calendar size={48} />
              <h3>No se encontraron eventos auditados</h3>
              <p>
                {hasActiveFilters
                  ? "No hay registros que coincidan con los filtros aplicados. Intenta ajustar el rango de fechas o categoría."
                  : "Aún no se han registrado eventos auditables en esta institución."}
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  className="activity-button-secondary"
                  onClick={handleResetFilters}
                >
                  Restablecer filtros
                </button>
              )}
            </div>
          ) : (
            <div className="activity-table-wrapper">
              <table className="activity-table">
                <thead>
                  <tr>
                    <th>Fecha y hora</th>
                    <th>Acción</th>
                    <th>Entidad</th>
                    <th>Actor</th>
                    <th>Resumen</th>
                    <th>Enlace</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((event: AuditEvent) => (
                    <tr key={event.id} className={`activity-row-${event.outcome.toLowerCase()}`}>
                      <td className="activity-cell-time">
                        <time dateTime={event.occurredAt}>
                          {formatTimestamp(event.occurredAt)}
                        </time>
                      </td>
                      <td className="activity-cell-action">
                        <span className={`activity-badge activity-badge-${event.outcome.toLowerCase()}`}>
                          {event.outcome === "SUCCESS" && <CheckCircle2 size={13} />}
                          {event.outcome === "FAILURE" && <XCircle size={13} />}
                          {event.outcome === "INFO" && <Info size={13} />}
                          {event.actionLabel}
                        </span>
                      </td>
                      <td className="activity-cell-entity">
                        <span className="activity-entity-tag">{event.entityLabel}</span>
                      </td>
                      <td className="activity-cell-actor">
                        <div className="activity-actor-info">
                          <User size={14} />
                          <div>
                            <strong>{event.actor.name}</strong>
                            {event.actor.email && <small>{event.actor.email}</small>}
                          </div>
                        </div>
                      </td>
                      <td className="activity-cell-summary">
                        <p>{event.summary}</p>
                      </td>
                      <td className="activity-cell-link">
                        {event.resourceLink ? (
                          <Link to={event.resourceLink} className="activity-link-btn" title="Ir al recurso">
                            <span>Ver</span>
                            <ExternalLink size={14} />
                          </Link>
                        ) : (
                          <span className="activity-no-link">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Barra de Paginación */}
              <div className="activity-pagination-bar">
                <span>
                  Página <strong>{data.page}</strong> de <strong>{data.totalPages}</strong> ({data.total} eventos registrados)
                </span>
                <div className="activity-pagination-buttons">
                  <button
                    type="button"
                    className="activity-button-secondary"
                    disabled={data.page <= 1}
                    onClick={() => {
                      setLoading(true);
                      setPage((p) => Math.max(1, p - 1));
                    }}
                  >
                    Anterior
                  </button>
                  <button
                    type="button"
                    className="activity-button-secondary"
                    disabled={data.page >= data.totalPages}
                    onClick={() => {
                      setLoading(true);
                      setPage((p) => p + 1);
                    }}
                  >
                    Siguiente
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
