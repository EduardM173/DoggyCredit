import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  HelpCircle,
  Info,
  Layers,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from "lucide-react";
import {
  fetchTenantPlanMetering,
  type TenantPlanMeteringDto,
} from "./api";
import "./plan-metering.css";

interface PlanAndUsagePageProps {
  slug: string;
  role: "INSTITUTION_ADMIN" | "ANALYST" | string;
  tenantName: string;
}

export function PlanAndUsagePage({ slug, role, tenantName }: PlanAndUsagePageProps) {
  const [data, setData] = useState<TenantPlanMeteringDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const isAdmin = role === "INSTITUTION_ADMIN";

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");

    fetchTenantPlanMetering(slug, controller.signal)
      .then((res) => {
        setData(res);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          err instanceof Error ? err.message : "No se pudo cargar la información del plan y consumo."
        );
        setLoading(false);
      });

    return () => controller.abort();
  }, [slug, reloadKey]);

  if (loading) {
    return (
      <main className="plan-metering-root" aria-busy="true">
        <div className="plan-loading-state">
          <RefreshCw className="animate-spin" size={32} />
          <p>Consultando plan contratado y consumo medido de {tenantName}...</p>
        </div>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="plan-metering-root">
        <section className="plan-error-state" role="alert">
          <AlertCircle size={40} color="#b91c1c" />
          <h2>No se pudo consultar el plan y consumo</h2>
          <p>{error || "Servicio temporalmente no disponible. Distinto de 0 consumos."}</p>
          <button
            type="button"
            className="plan-retry-btn"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            <RefreshCw size={16} /> Reintentar consulta
          </button>
        </section>
      </main>
    );
  }

  const { plan, subscription, capacity, cycle, permissions, scoring, environment } = data;

  const formatDate = (isoString: string | null) => {
    if (!isoString) return "No configurado";
    try {
      return new Date(isoString).toLocaleDateString("es-BO", {
        timeZone: "America/La_Paz",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return isoString;
    }
  };

  return (
    <main className="plan-metering-root" aria-label="Plan contratado y consumo institucional">
      {/* Breadcrumb */}
      <div className="institution-breadcrumb">
        <Link to={`/${slug}`}>Inicio</Link>
        <ArrowRight size={14} aria-hidden="true" />
        <span>Plan y consumo</span>
      </div>

      {/* Header */}
      <header className="plan-metering-header">
        <div className="plan-metering-title-group">
          <p className="institution-eyebrow">SUSCRIPCIÓN Y CAPACIDADES</p>
          <h1>Plan y consumo de {data.tenant.name}</h1>
          <div className="plan-metering-badges">
            <span
              className={`plan-status-badge ${subscription.status.toLowerCase()}`}
              title={`Estado de suscripción: ${subscription.status}`}
            >
              {subscription.status === "ACTIVE" ? (
                <>
                  <ShieldCheck size={14} aria-hidden="true" /> Suscripción Activa
                </>
              ) : subscription.status === "SUSPENDED" ? (
                <>
                  <ShieldAlert size={14} aria-hidden="true" /> Suscripción Suspendida
                </>
              ) : (
                <>
                  <HelpCircle size={14} aria-hidden="true" /> Sin Suscripción Activa
                </>
              )}
            </span>

            <span className="plan-role-badge">
              {isAdmin ? "Administración Institucional" : "Analista de Crédito"}
            </span>
          </div>
        </div>

        <div className="plan-metering-recency" title={`Actualizado a las ${data.asOf}`}>
          <Clock size={14} aria-hidden="true" />
          <span>Vigente: {formatDate(data.asOf)}</span>
        </div>
      </header>

      {/* Alerta de Límite Alcanzado (CA-21.04, CA-21.05) */}
      {capacity.isExceeded && (
        <section className="quota-alert-banner" role="alert" aria-live="assertive">
          <AlertTriangle size={28} aria-hidden="true" />
          <div>
            <h3>Límite de evaluaciones alcanzado en el ciclo actual</h3>
            {isAdmin ? (
              <p>
                Tu institución ha consumido el 100% de las <strong>{capacity.limit} evaluaciones</strong>{" "}
                permitidas en su plan mensual. Comunícate con soporte de DoggyCredit para solicitar una
                ampliación de capacidad. Las evaluaciones existentes y el historial siguen 100% disponibles.
              </p>
            ) : (
              <p>
                Tu institución ha alcanzado el límite mensual de evaluaciones contratadas. Para iniciar nuevas
                evaluaciones, por favor <strong>contacta a tu administrador institucional</strong> para que
                gestione una ampliación de plan.
              </p>
            )}
          </div>
        </section>
      )}

      {/* Layout de Contenido */}
      <div className="plan-metering-grid">
        {/* Card Principal: Capacidad y Medición de Uso */}
        <section className="capacity-card" aria-labelledby="capacity-title">
          <div className="capacity-card-header">
            <h2 id="capacity-title">Consumo de Evaluaciones</h2>
            <span className={`capacity-state-tag ${capacity.state.toLowerCase()}`}>
              {capacity.state}
            </span>
          </div>

          {capacity.state === "LIMITADO" ? (
            <div className="capacity-progress-container">
              <div className="capacity-progress-labels">
                <div>
                  <span className="capacity-numbers">{capacity.consumed}</span>
                  <span className="capacity-unit">de {capacity.limit} evaluaciones consumidas</span>
                </div>
                <span className="capacity-percent">{capacity.percentage}%</span>
              </div>

              <div className="capacity-progress-bar-bg" aria-hidden="true">
                <div
                  className={`capacity-progress-bar-fill ${
                    capacity.isExceeded
                      ? "exceeded"
                      : (capacity.percentage ?? 0) >= 80
                      ? "warning"
                      : ""
                  }`}
                  style={{ width: `${Math.min(100, capacity.percentage ?? 0)}%` }}
                />
              </div>

              <div className="capacity-details-list">
                <div className="capacity-detail-row">
                  <span>Evaluaciones restantes en este ciclo:</span>
                  <strong>{capacity.remaining}</strong>
                </div>
                <div className="capacity-detail-row">
                  <span>Período de medición mensual:</span>
                  <span>
                    {formatDate(cycle.startDate)} — {formatDate(cycle.endDate)}
                  </span>
                </div>
                <div className="capacity-detail-row">
                  <span>Próxima renovación de cuota:</span>
                  <span>{formatDate(cycle.renewalDate)} (00:00 La Paz)</span>
                </div>
              </div>
            </div>
          ) : capacity.state === "ILIMITADO" ? (
            <div className="capacity-progress-container">
              <div className="capacity-progress-labels">
                <div>
                  <span className="capacity-numbers">{capacity.consumed}</span>
                  <span className="capacity-unit">evaluaciones procesadas (Sin límite mensual)</span>
                </div>
                <span className="capacity-percent">Ilimitado</span>
              </div>

              <div className="capacity-progress-bar-bg" aria-hidden="true">
                <div className="capacity-progress-bar-fill" style={{ width: "100%" }} />
              </div>

              <div className="capacity-details-list">
                <div className="capacity-detail-row">
                  <span>Régimen de capacidad:</span>
                  <strong>Evaluaciones Ilimitadas garantizadas por contrato</strong>
                </div>
                <div className="capacity-detail-row">
                  <span>Ciclo de auditoría:</span>
                  <span>
                    {formatDate(cycle.startDate)} — {formatDate(cycle.endDate)}
                  </span>
                </div>
              </div>
            </div>
          ) : capacity.state === "NO_CONFIGURADO" ? (
            <div className="capacity-progress-container">
              <p>
                La institución no tiene una suscripción comercial activa registrada. No se autoriza
                procesamiento por omisión (CA-21.02).
              </p>
            </div>
          ) : (
            <div className="capacity-progress-container">
              <p>
                La suscripción se encuentra suspendida o no disponible. No es posible procesar nuevas
                evaluaciones en este momento.
              </p>
            </div>
          )}
        </section>

        {/* Card Lateral: Resumen del Plan y Términos */}
        <section className="plan-summary-card" aria-labelledby="plan-title">
          <h2 id="plan-title">Plan Contratado</h2>
          {plan ? (
            <>
              <div>
                <strong style={{ fontSize: "1.1rem", color: "#0f172a" }}>{plan.name}</strong>
                <p style={{ margin: "0.25rem 0 0", color: "#64748b", fontSize: "0.9rem" }}>
                  {plan.description || "Plan institucional para evaluación crediticia."}
                </p>
              </div>

              {/* Términos comerciales (Ana los ve, Carlos no) (CA-21.05) */}
              {permissions.canViewCommercialTerms && (
                <div className="plan-commercial-terms">
                  <span className="plan-price-label">Precio acordado:</span>
                  <span className="plan-price-value">
                    {plan.price === 0 ? "Gratuito" : `${plan.price} ${plan.currency} / mes`}
                  </span>
                </div>
              )}

              <div>
                <p style={{ fontWeight: 600, fontSize: "0.88rem", marginBottom: "0.5rem" }}>
                  Capacidades incluidas:
                </p>
                <ul className="plan-features-list">
                  {plan.features.map((feature, idx) => (
                    <li key={idx} className="plan-feature-item">
                      <CheckCircle2 size={16} aria-hidden="true" />
                      <span>{feature}</span>
                    </li>
                  ))}
                  <li className="plan-feature-item">
                    <CheckCircle2 size={16} aria-hidden="true" />
                    <span>
                      Usuarios: {plan.maxUsers ? `Hasta ${plan.maxUsers} miembros` : "Ilimitados"}
                    </span>
                  </li>
                </ul>
              </div>
            </>
          ) : (
            <p>No hay plan asignado a esta institución.</p>
          )}
        </section>
      </div>

      {/* Avisos Informativos y Transparencia Regulatoria (CA-21.06, CA-21.08, CA-21.10) */}
      <footer className="plan-notices-container" aria-label="Notas informativas y operativas">
        {/* Transparencia de Scoring */}
        <div className="plan-info-box">
          <h4>
            <Zap size={16} aria-hidden="true" />
            Metodología de Evaluación y Reglas Institucionales
          </h4>
          <p>{scoring.description}</p>
        </div>

        {/* Aviso de Simulación Comercial */}
        <div className="plan-info-box plan-simulation-notice">
          <h4>
            <Info size={16} aria-hidden="true" />
            Entorno de Simulación
          </h4>
          <p>{environment.disclaimer}</p>
        </div>
      </footer>
    </main>
  );
}
