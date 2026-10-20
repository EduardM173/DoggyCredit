import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BarChart2,
  Building2,
  CheckCircle2,
  Clock,
  Layers,
  Package,
  Plus,
  RefreshCw,
  ShieldAlert,
  Users,
} from "lucide-react";
import {
  fetchDashboard,
  type DashboardMetricsDto,
  type DashboardPeriod,
} from "./api";
import "./dashboard.css";

interface InstitutionDashboardProps {
  slug: string;
  role: "INSTITUTION_ADMIN" | "ANALYST" | string;
  ready: boolean;
  userName: string;
}

export function InstitutionDashboard({
  slug,
  role,
  ready,
  userName,
}: InstitutionDashboardProps) {
  const [period, setPeriod] = useState<DashboardPeriod>("last_30_days");
  const [data, setData] = useState<DashboardMetricsDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const isAdmin = role === "INSTITUTION_ADMIN";
  const firstName = userName.includes("@") ? userName : userName.split(" ")[0];

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");

    fetchDashboard(slug, period, controller.signal)
      .then((metrics) => {
        setData(metrics);
        setError("");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error
            ? err.message
            : "No se pudieron cargar los datos del dashboard. Intenta de nuevo.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [slug, period, reloadKey]);

  const formatRecency = (isoString?: string) => {
    if (!isoString) return "";
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  };

  if (loading && !data) {
    return (
      <main className="dashboard-root" aria-busy="true">
        <p role="status">Cargando métricas de la institución...</p>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="dashboard-root">
        <section className="dashboard-error-panel" role="alert">
          <AlertCircle size={32} />
          <div>
            <h2>Error al consultar el dashboard</h2>
            <p>{error}</p>
          </div>
          <button
            type="button"
            className="dashboard-cta-secondary"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RefreshCw size={16} /> Reintentar
          </button>
        </section>
      </main>
    );
  }

  if (!data) return null;

  return (
    <main className="dashboard-root" aria-label="Tablero de gestión institucional">
      {/* Encabezado y Contexto (CA-20.01) */}
      <header className="dashboard-header">
        <div className="dashboard-title-group">
          <p className="institution-eyebrow">PORTAL INSTITUCIONAL — INICIO</p>
          <h1>{data.tenant.name}</h1>
          <div className="dashboard-role-badge-container">
            <span
              className={`dashboard-role-badge ${isAdmin ? "admin" : "analyst"}`}
              title={`Sesión activa como ${isAdmin ? "Administradora" : "Analista"}`}
            >
              {isAdmin ? "Administración Institucional" : "Analista de Crédito"}
            </span>
            <span className="dashboard-welcome">Bienvenido/a, {firstName}</span>
          </div>
        </div>

        <div className="dashboard-controls">
          <label htmlFor="dashboard-period-select" className="visually-hidden">
            Período temporal
          </label>
          <select
            id="dashboard-period-select"
            className="dashboard-period-select"
            value={period}
            onChange={(e) => setPeriod(e.target.value as DashboardPeriod)}
            aria-label="Seleccionar período de visualización"
          >
            <option value="last_30_days">Últimos 30 días</option>
            <option value="last_7_days">Últimos 7 días</option>
            <option value="today">Hoy</option>
            <option value="month_to_date">Mes actual a la fecha</option>
          </select>

          <span className="dashboard-recency" title={`Actualizado a las ${formatRecency(data.asOf)}`}>
            <Clock size={14} aria-hidden="true" />
            Recencia: {formatRecency(data.asOf)}
          </span>
        </div>
      </header>

      {/* Bloque 1: Asuntos que requieren atención (CA-20.02, CA-20.04) */}
      <section className="dashboard-attention-section" aria-labelledby="attention-title">
        <div className="dashboard-attention-header">
          <h2 id="attention-title" className="dashboard-attention-title">
            <AlertTriangle size={20} aria-hidden="true" />
            Asuntos que requieren atención
          </h2>
        </div>

        {data.attentionRequiredCount > 0 ? (
          <div className="dashboard-attention-list" role="feed" aria-label="Evaluaciones con pendientes">
            {data.pendingAttention.map((item) => (
              <article
                key={item.id}
                className={`dashboard-attention-card ${item.status === "FAILED" ? "failed" : "incomplete"}`}
              >
                <div className="dashboard-attention-item-header">
                  <strong>{item.applicantName}</strong>
                  <span
                    className={`dashboard-status-tag ${item.status === "FAILED" ? "failed" : "incomplete"}`}
                  >
                    {item.status === "FAILED" ? "Falla técnica" : "Datos incompletos"}
                  </span>
                </div>
                <p className="dashboard-attention-desc">{item.reasonText}</p>
                <small className="dashboard-attention-clarification">
                  {item.status === "FAILED"
                    ? "Una falla técnica no significa que el crédito fue rechazado; permite reintentar la consulta de fuentes."
                    : "No se cuenta con información suficiente para evaluar. Revisa los datos o el historial."}
                </small>
                <Link to={item.actionUrl} className="dashboard-attention-action">
                  {item.actionableType === "RETRY" ? "Reintentar evaluación" : "Revisar evaluación"}
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="dashboard-all-clear" role="status">
            <CheckCircle2 size={20} aria-hidden="true" />
            <span>Al día: No hay evaluaciones con fallas o datos incompletos pendientes de atención.</span>
          </div>
        )}
      </section>

      {/* Acciones Rápidas */}
      <section className="dashboard-quick-actions" aria-label="Acciones principales">
        {ready ? (
          <Link to={`/${slug}/evaluaciones/nueva`} className="dashboard-cta-primary">
            <Plus size={18} aria-hidden="true" />
            Nueva evaluación
          </Link>
        ) : (
          <span className="dashboard-cta-disabled" title="Completa la preparación institucional">
            Evaluaciones pendientes de preparación
          </span>
        )}

        <Link to={`/${slug}/evaluaciones`} className="dashboard-cta-secondary">
          <BarChart2 size={16} aria-hidden="true" />
          Ver todas las evaluaciones
        </Link>

        {/* Controles exclusivos de administración (CA-20.02) */}
        {data.permissions?.canManageTeam && (
          <Link to={`/${slug}/equipo`} className="dashboard-cta-secondary">
            <Users size={16} aria-hidden="true" />
            Gestionar equipo
          </Link>
        )}

        {data.permissions?.canManageProducts && (
          <Link to={`/${slug}/productos`} className="dashboard-cta-secondary">
            <Package size={16} aria-hidden="true" />
            Catálogo de productos
          </Link>
        )}
      </section>

      {/* Banner de bienvenida y preparación institucional (CA-20.08) */}
      {isAdmin && ready && !data.hasEvaluations && (
        <section className="institution-ready">
          <CheckCircle2 size={28} aria-hidden="true" />
          <div>
            <h2>Tu institución está lista</h2>
            <p>Invita a un analista para comenzar a trabajar en {data.tenant?.name}.</p>
            <Link className="institution-primary" to={`/${slug}/equipo`}>
              <Users size={20} />
              Invitar analista
            </Link>
          </div>
        </section>
      )}

      {/* Bloque 2: Indicadores Agregados del Período (CA-20.03, CA-20.08, CA-20.14) */}
      {!data.hasEvaluations ? (
        <section className="dashboard-empty-panel">
          <Building2 size={40} color="#94a3b8" aria-hidden="true" />
          <h2>Comienza a evaluar en {data.tenant.name}</h2>
          <p>
            Tu institución aún no ha registrado evaluaciones. Inicia la primera evaluación para generar
            historial y recomendaciones crediticias basadas en las fuentes financieras disponibles.
          </p>
          {ready && (
            <Link to={`/${slug}/evaluaciones/nueva`} className="dashboard-cta-primary">
              <Plus size={18} aria-hidden="true" />
              Realizar primera evaluación
            </Link>
          )}
        </section>
      ) : !data.hasPeriodActivity ? (
        <section className="dashboard-empty-panel">
          <Layers size={36} color="#94a3b8" aria-hidden="true" />
          <h2>Sin movimientos en el período seleccionado</h2>
          <p>
            No se registraron evaluaciones durante {data.period.label.toLowerCase()}. Puedes cambiar el período
            a "Últimos 30 días" o iniciar una nueva evaluación.
          </p>
          {ready && (
            <Link to={`/${slug}/evaluaciones/nueva`} className="dashboard-cta-primary">
              <Plus size={18} aria-hidden="true" />
              Nueva evaluación
            </Link>
          )}
        </section>
      ) : (
        <section className="dashboard-metrics-grid" aria-label="Indicadores de desempeño del período">
          {/* Card 1: Total Evaluaciones */}
          <article className="dashboard-metric-card">
            <div className="dashboard-metric-header">
              <span>Total Evaluaciones</span>
              <BarChart2 size={18} aria-hidden="true" />
            </div>
            <div className="dashboard-metric-value">{data.metrics.totalEvaluations}</div>
            <p className="dashboard-metric-detail">
              En {data.period.label.toLowerCase()} ({data.metrics.byStatus.COMPLETED} completadas)
            </p>
            <Link
              to={`/${slug}/evaluaciones?period=${period}`}
              className="dashboard-metric-link"
              title="Ver listado en Evaluaciones"
            >
              Consultar historial <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </article>

          {/* Card 2: Tasa de Finalización */}
          <article className="dashboard-metric-card">
            <div className="dashboard-metric-header">
              <span>Tasa de Finalización</span>
              <CheckCircle2 size={18} aria-hidden="true" />
            </div>
            {data.metrics.completionRate !== null ? (
              <div className="dashboard-metric-value">{data.metrics.completionRate}%</div>
            ) : (
              <div className="dashboard-metric-value na">No disponible / Datos insuficientes</div>
            )}
            <p className="dashboard-metric-detail">
              Evaluaciones que completaron consulta de fuentes frente al total cerrado.
            </p>
          </article>

          {/* Card 3: Compatibilidad de Catálogo */}
          <article className="dashboard-metric-card">
            <div className="dashboard-metric-header">
              <span>Compatibilidad con Catálogo</span>
              <Package size={18} aria-hidden="true" />
            </div>
            {data.metrics.catalogCompatibility.rate !== null ? (
              <div className="dashboard-metric-value">
                {data.metrics.catalogCompatibility.rate}%
              </div>
            ) : (
              <div className="dashboard-metric-value na">No disponible / Datos insuficientes</div>
            )}
            <p className="dashboard-metric-detail">
              {data.metrics.catalogCompatibility.compatibleCount} con al menos un producto activo recomendado.
            </p>
          </article>

          {/* Card 4: Distribución por Alcance */}
          <article className="dashboard-metric-card">
            <div className="dashboard-metric-header">
              <span>Tipo de Solicitante</span>
              <Users size={18} aria-hidden="true" />
            </div>
            <div className="dashboard-metric-scope-breakdown">
              <div>
                <strong>Personas:</strong> {data.metrics.byScope.PERSON}
              </div>
              <div>
                <strong>Empresas:</strong> {data.metrics.byScope.COMPANY}
              </div>
            </div>
            <p className="dashboard-metric-detail">Distribución de demanda en el período.</p>
          </article>
        </section>
      )}
    </main>
  );
}
