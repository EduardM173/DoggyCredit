import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  ExternalLink,
  Filter,
  History,
  Info,
  RotateCcw,
  ShieldCheck,
  User,
  XCircle,
} from "lucide-react";
import {
  fetchPlatformAudit,
  type PlatformAuditCategory,
  type PlatformAuditEvent,
  type PlatformAuditPage,
} from "./api";

export function AdminActivityLogPage() {
  const [data, setData] = useState<PlatformAuditPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  // Filtros
  const [page, setPage] = useState(1);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [category, setCategory] = useState<PlatformAuditCategory | "">("");
  const [tenantId, setTenantId] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    fetchPlatformAudit(
      {
        page,
        pageSize: 15,
        from: from || undefined,
        to: to || undefined,
        category: category || undefined,
        tenantId: tenantId.trim() || undefined,
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
            : "No se pudo cargar la auditoría operativa de plataforma.",
        );
        setLoading(false);
      });

    return () => controller.abort();
  }, [page, from, to, category, tenantId, reloadKey]);

  const hasActiveFilters = Boolean(from || to || category || tenantId);

  const handleResetFilters = () => {
    setFrom("");
    setTo("");
    setCategory("");
    setTenantId("");
    setPage(1);
    setLoading(true);
  };

  const formatTimestamp = (isoDate: string) => {
    try {
      return new Intl.DateTimeFormat("es-BO", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "UTC",
      }).format(new Date(isoDate));
    } catch {
      return isoDate;
    }
  };

  return (
    <main className="admin-page-container" aria-label="Auditoría operativa">
      <header className="admin-page-header">
        <p className="admin-eyebrow">AUDITORÍA Y TRAZABILIDAD</p>
        <h1>Auditoría operativa de plataforma</h1>
        <p className="admin-lead">
          Supervisión cronológica de eventos de ciclo de vida de instituciones, contrataciones y proveedores externos.
        </p>
      </header>

      {/* CA-24.04 / CA-24.05: Banner de Garantía de Privacidad Operativa */}
      <section className="admin-privacy-banner" aria-label="Garantía de privacidad operativa">
        <ShieldCheck size={24} />
        <div>
          <strong>Privacidad operativa garantizada (RF-05 / CA-24.04)</strong>
          <p>
            Esta vista de plataforma omite estrictamente información confidencial de solicitantes (CI/NIT, deudas,
            ingresos, buró crudo o dictámenes crediticios individuales). Solo muestra eventos del ciclo de vida de tenants.
          </p>
        </div>
      </section>

      {/* Barra de Filtros */}
      <section className="admin-filters-card" aria-label="Filtros de auditoría">
        <div className="admin-filters-title">
          <Filter size={18} />
          <strong>Filtrar actividad operativa</strong>
        </div>

        <div className="admin-filters-grid">
          <label className="admin-filter-field">
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

          <label className="admin-filter-field">
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

          <label className="admin-filter-field">
            <span>Categoría</span>
            <select
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as PlatformAuditCategory | "");
                setPage(1);
                setLoading(true);
              }}
              aria-label="Categoría de evento"
            >
              <option value="">Todas las categorías operativas</option>
              <option value="PLATFORM">Proveedores e integraciones</option>
              <option value="OPERATIONS">Solicitudes, contratos y aprovisionamiento</option>
            </select>
          </label>

          <label className="admin-filter-field">
            <span>ID Institución (opcional)</span>
            <input
              type="text"
              placeholder="UUID de la institución"
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value);
                setPage(1);
                setLoading(true);
              }}
              aria-label="Filtro por ID de institución"
            />
          </label>

          {hasActiveFilters && (
            <div className="admin-filter-reset">
              <button
                type="button"
                className="admin-button-secondary"
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
        <div className="admin-state-container" role="status">
          <History className="admin-spin" size={32} />
          <p>Cargando registros operativos de plataforma...</p>
        </div>
      )}

      {error && !loading && (
        <div className="admin-error-banner" role="alert">
          <AlertCircle size={24} />
          <div>
            <strong>Error al consultar la auditoría</strong>
            <p>{error}</p>
          </div>
          <button
            type="button"
            className="admin-button-primary"
            onClick={() => {
              setLoading(true);
              setReloadKey((k) => k + 1);
            }}
          >
            Reintentar
          </button>
        </div>
      )}

      {/* Tabla de Eventos */}
      {!loading && !error && data && (
        <>
          {data.items.length === 0 ? (
            <div className="admin-empty-state">
              <Calendar size={48} />
              <h3>No se encontraron registros de auditoría</h3>
              <p>
                {hasActiveFilters
                  ? "No hay eventos que coincidan con los criterios de búsqueda aplicados."
                  : "Aún no se registran eventos operativos en la plataforma."}
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  className="admin-button-secondary"
                  onClick={handleResetFilters}
                >
                  Restablecer filtros
                </button>
              )}
            </div>
          ) : (
            <div className="admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Fecha y hora (UTC)</th>
                    <th>Acción</th>
                    <th>Entidad</th>
                    <th>Actor</th>
                    <th>Resumen</th>
                    <th>Enlace operativo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((event: PlatformAuditEvent) => (
                    <tr key={event.id} className={`admin-row-${event.outcome.toLowerCase()}`}>
                      <td className="admin-cell-time">
                        <time dateTime={event.occurredAt}>
                          {formatTimestamp(event.occurredAt)}
                        </time>
                      </td>
                      <td className="admin-cell-action">
                        <span className={`admin-badge admin-badge-${event.outcome.toLowerCase()}`}>
                          {event.outcome === "SUCCESS" && <CheckCircle2 size={13} />}
                          {event.outcome === "FAILURE" && <XCircle size={13} />}
                          {event.outcome === "INFO" && <Info size={13} />}
                          {event.actionLabel}
                        </span>
                      </td>
                      <td className="admin-cell-entity">
                        <span className="admin-entity-tag">{event.entityLabel}</span>
                      </td>
                      <td className="admin-cell-actor">
                        <div className="admin-actor-info">
                          <User size={14} />
                          <div>
                            <strong>{event.actor.name}</strong>
                            {event.actor.email && <small>{event.actor.email}</small>}
                          </div>
                        </div>
                      </td>
                      <td className="admin-cell-summary">
                        <p>{event.summary}</p>
                      </td>
                      <td className="admin-cell-link">
                        {event.resourceLink ? (
                          <Link to={event.resourceLink} className="admin-link-btn" title="Ir al recurso">
                            <span>Ver</span>
                            <ExternalLink size={14} />
                          </Link>
                        ) : (
                          <span className="admin-no-link">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Barra de Paginación */}
              <div className="admin-pagination-bar">
                <span>
                  Página <strong>{data.page}</strong> de <strong>{data.totalPages}</strong> ({data.total} eventos registrados)
                </span>
                <div className="admin-pagination-buttons">
                  <button
                    type="button"
                    className="admin-button-secondary"
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
                    className="admin-button-secondary"
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
