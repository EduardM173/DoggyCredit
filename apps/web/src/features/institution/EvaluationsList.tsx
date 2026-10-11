import { useEffect, useState, useTransition } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  Plus,
  Search,
  X,
} from "lucide-react";
import { fetchEvaluations, type EvaluationItem } from "./api";
import "./evaluations.css";

const PURPOSE_LABELS: Record<string, string> = {
  WORKING_CAPITAL: "Capital de trabajo",
  BUSINESS_INVESTMENT: "Inversión",
  GREEN_PROJECT: "Proyecto verde",
  EQUIPMENT: "Equipamiento",
  OTHER: "Otro",
};

export function EvaluationsList({
  slug,
  tenantName,
  ready,
}: {
  slug: string;
  tenantName: string;
  ready: boolean;
}) {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  const searchQuery = searchParams.get("search") || "";
  const statusFilter = searchParams.get("status") || "ALL";
  const pageQuery = Math.max(1, Number(searchParams.get("page")) || 1);

  const [evaluations, setEvaluations] = useState<EvaluationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();

  const [prevSearchQuery, setPrevSearchQuery] = useState(searchQuery);
  const [searchInput, setSearchInput] = useState(searchQuery);

  // Sync search input if query param changes externally (e.g. back navigation)
  if (prevSearchQuery !== searchQuery) {
    setPrevSearchQuery(searchQuery);
    setSearchInput(searchQuery);
  }

  useEffect(() => {
    let active = true;
    fetchEvaluations(slug, {
      search: searchQuery,
      status: statusFilter,
      page: pageQuery,
      limit: 10,
    })
      .then((data) => {
        if (!active) return;
        setEvaluations(data.items || []);
        setTotal(data.total || 0);
        setTotalPages(data.totalPages || 1);
        setError("");
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Error al cargar evaluaciones.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug, searchQuery, statusFilter, pageQuery]);

  const updateFilters = (newSearch: string, newStatus: string, newPage = 1) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (newSearch.trim()) params.set("search", newSearch.trim());
    if (newStatus && newStatus !== "ALL") params.set("status", newStatus);
    if (newPage > 1) params.set("page", String(newPage));
    setSearchParams(params);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(() => {
      updateFilters(searchInput, statusFilter, 1);
    });
  };

  const handleStatusChange = (newStatus: string) => {
    startTransition(() => {
      updateFilters(searchQuery, newStatus, 1);
    });
  };

  const handlePageChange = (newPage: number) => {
    startTransition(() => {
      updateFilters(searchQuery, statusFilter, newPage);
    });
  };

  const handleClearFilters = () => {
    setSearchInput("");
    setLoading(true);
    setSearchParams(new URLSearchParams());
  };

  const hasActiveFilters = Boolean(searchQuery.trim() || (statusFilter && statusFilter !== "ALL"));

  const renderStatusBadge = (status: EvaluationItem["status"]) => {
    switch (status) {
      case "COMPLETED":
        return (
          <span className="eval-status-badge eval-status-COMPLETED">
            <CheckCircle2 size={13} /> Completada
          </span>
        );
      case "IN_PROGRESS":
        return (
          <span className="eval-status-badge eval-status-IN_PROGRESS">
            <Clock size={13} /> En proceso
          </span>
        );
      case "INCOMPLETE":
        return (
          <span className="eval-status-badge eval-status-INCOMPLETE">
            <AlertCircle size={13} /> Información parcial
          </span>
        );
      case "FAILED":
        return (
          <span className="eval-status-badge eval-status-FAILED">
            <AlertTriangle size={13} /> Fallo técnico
          </span>
        );
      case "DRAFT":
      default:
        return (
          <span className="eval-status-badge eval-status-DRAFT">
            <FileText size={13} /> Borrador
          </span>
        );
    }
  };

  const getActionLabel = (status: EvaluationItem["status"]) => {
    switch (status) {
      case "COMPLETED":
        return "Ver resultado";
      case "IN_PROGRESS":
        return "Ver estado";
      case "INCOMPLETE":
        return "Ver detalle";
      case "FAILED":
        return "Reintentar";
      case "DRAFT":
      default:
        return "Continuar borrador";
    }
  };

  return (
    <main className="eval-container">
      <div className="institution-breadcrumb" style={{ marginBottom: 16 }}>
        <Link to={`/${slug}`}>Inicio</Link>
        <ArrowRight size={16} /> Evaluaciones
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
        <div>
          <p className="eval-eyebrow">HISTORIAL DE EVALUACIONES</p>
          <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, color: "#0b1f4d" }}>
            Evaluaciones de {tenantName}
          </h1>
        </div>
        {ready && (
          <Link className="eval-btn-primary" to={`/${slug}/evaluaciones/nueva`}>
            <Plus size={18} /> Nueva evaluación
          </Link>
        )}
      </div>

      {/* Filter and Search Bar (CA-18.02, PA-18.04) */}
      <div className="eval-filters-bar">
        <form onSubmit={handleSearchSubmit} className="eval-search-form">
          <Search size={16} color="#51627d" className="eval-search-icon" />
          <input
            type="text"
            className="eval-search-input"
            placeholder="Buscar por solicitante o documento..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          {searchInput && (
            <button
              type="button"
              className="eval-search-clear"
              onClick={() => {
                setSearchInput("");
                updateFilters("", statusFilter, 1);
              }}
              aria-label="Limpiar búsqueda"
            >
              <X size={14} />
            </button>
          )}
          <button type="submit" className="eval-btn-secondary" style={{ height: 40, padding: "0 14px" }}>
            Buscar
          </button>
        </form>

        <div className="eval-status-filter-wrapper">
          <label htmlFor="eval-status-select" className="eval-filter-label">Estado:</label>
          <select
            id="eval-status-select"
            className="eval-status-select"
            value={statusFilter}
            onChange={(e) => handleStatusChange(e.target.value)}
          >
            <option value="ALL">Todos los estados</option>
            <option value="COMPLETED">Completada</option>
            <option value="IN_PROGRESS">En proceso</option>
            <option value="INCOMPLETE">Información parcial</option>
            <option value="FAILED">Fallo técnico</option>
            <option value="DRAFT">Borrador</option>
          </select>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            className="eval-btn-clear-filters"
            onClick={handleClearFilters}
          >
            Limpiar filtros
          </button>
        )}
      </div>

      {loading ? (
        <div className="eval-card" style={{ textAlign: "center", padding: 48 }}>
          <div className="eval-spinner" />
          <p style={{ color: "#51627d" }}>Cargando historial de evaluaciones...</p>
        </div>
      ) : error ? (
        <div className="eval-card" style={{ textAlign: "center", padding: 48 }}>
          <AlertCircle size={36} color="#b42318" style={{ margin: "0 auto 12px" }} />
          <p style={{ color: "#b42318", fontWeight: 600 }}>{error}</p>
        </div>
      ) : evaluations.length === 0 ? (
        hasActiveFilters ? (
          /* Empty State B: Search/Filter without matches (CA-18.03, PA-18.02) */
          <div className="eval-card" style={{ textAlign: "center", padding: 48 }}>
            <Search size={42} color="#51627d" style={{ margin: "0 auto 16px" }} />
            <h2 style={{ fontSize: 20, margin: "0 0 8px", color: "#0b1f4d" }}>
              No se encontraron coincidencias para los filtros aplicados
            </h2>
            <p style={{ color: "#51627d", maxWidth: 460, margin: "0 auto 24px" }}>
              No existen evaluaciones que coincidan con la búsqueda o el estado seleccionado.
              Puedes limpiar los filtros para ver todo el historial de la entidad.
            </p>
            <button className="eval-btn-secondary" onClick={handleClearFilters}>
              Limpiar búsqueda y filtros
            </button>
          </div>
        ) : (
          /* Empty State A: Empty List (CA-18.03, PA-18.02) */
          <div className="eval-card" style={{ textAlign: "center", padding: 48 }}>
            <FileText size={42} color="#1267e8" style={{ margin: "0 auto 16px" }} />
            <h2 style={{ fontSize: 20, margin: "0 0 8px", color: "#0b1f4d" }}>
              No hay evaluaciones registradas
            </h2>
            <p style={{ color: "#51627d", maxWidth: 440, margin: "0 auto 24px" }}>
              Comienza evaluando a un solicitante para verificar su información financiera y generar
              recomendaciones crediticias institucionales.
            </p>
            {ready ? (
              <Link className="eval-btn-primary" to={`/${slug}/evaluaciones/nueva`}>
                <Plus size={18} /> Iniciar primera evaluación
              </Link>
            ) : (
              <p style={{ color: "#b54708", fontSize: 14 }}>
                La institución debe completar su preparación antes de poder evaluar.
              </p>
            )}
          </div>
        )
      ) : (
        <div className="eval-card" style={{ padding: 0, overflow: "hidden" }}>
          <table className="eval-list-table">
            <thead>
              <tr>
                <th>Solicitante</th>
                <th>Finalidad</th>
                <th>Monto solicitado</th>
                <th>Estado</th>
                <th>Fecha</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {evaluations.map((ev) => (
                <tr key={ev.id}>
                  <td>
                    <strong>{ev.clientName}</strong>
                    <div style={{ fontSize: 13, color: "#51627d" }}>
                      {ev.documentType}: {ev.documentNumber}
                    </div>
                  </td>
                  <td>{PURPOSE_LABELS[ev.purpose] || ev.purpose}</td>
                  <td style={{ fontWeight: 600 }}>
                    Bs. {ev.requestedAmount.toLocaleString("es-BO", { minimumFractionDigits: 2 })}
                  </td>
                  <td>{renderStatusBadge(ev.status)}</td>
                  <td style={{ color: "#51627d", fontSize: 13 }}>
                    {new Date(ev.createdAt).toLocaleDateString("es-BO")}
                  </td>
                  <td>
                    <Link
                      to={`/${slug}/evaluaciones/${ev.id}`}
                      state={{ from: `${location.pathname}${location.search}` }}
                      style={{ color: "#1267e8", fontWeight: 600, fontSize: 13, textDecoration: "none" }}
                    >
                      {getActionLabel(ev.status)}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination Toolbar (CA-18.08) */}
          {totalPages > 1 && (
            <div className="eval-pagination">
              <span className="eval-pagination-info">
                Página {pageQuery} de {totalPages} ({total} casos registrados)
              </span>
              <div className="eval-pagination-controls">
                <button
                  type="button"
                  className="eval-btn-secondary"
                  disabled={pageQuery <= 1}
                  onClick={() => handlePageChange(pageQuery - 1)}
                  style={{ height: 36, padding: "0 12px" }}
                >
                  <ChevronLeft size={16} /> Anterior
                </button>
                <button
                  type="button"
                  className="eval-btn-secondary"
                  disabled={pageQuery >= totalPages}
                  onClick={() => handlePageChange(pageQuery + 1)}
                  style={{ height: 36, padding: "0 12px" }}
                >
                  Siguiente <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
