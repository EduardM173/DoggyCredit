import { useEffect, useRef, useState } from "react";
import { IntegrationNotice } from "./IntegrationNotice";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Award,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  FileText,
  Lock,
  Plus,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  User,
  XCircle,
} from "lucide-react";
import {
  fetchEvaluation,
  processEvaluation,
  type EvaluationDetailItem,
  type ProfileIndicatorProvenanceDto,
} from "./api";
import {
  formatAsOf,
  nextPollDelay,
  retryEvaluation,
  statusAnnouncement,
  type RecoveryFields,
} from "./evaluationRecovery";
import "./evaluations.css";
import "./EvaluationDetail.css";

const PURPOSE_LABELS: Record<string, string> = {
  WORKING_CAPITAL: "Capital de trabajo",
  BUSINESS_INVESTMENT: "Inversión empresarial",
  GREEN_PROJECT: "Proyecto verde / sostenible",
  EQUIPMENT: "Maquinaria y equipamiento",
  OTHER: "Otra finalidad",
};

const CATEGORY_NAMES: Record<string, string> = {
  MICRO_CREDIT: "Microcrédito",
  GREEN_CREDIT: "Crédito Verde",
  SME_CREDIT: "Crédito PYME",
};

export function EvaluationDetail({ slug }: { slug: string }) {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const backUrl = (location.state as { from?: string } | null)?.from || `/${slug}/evaluaciones`;
  const [evaluation, setEvaluation] = useState<EvaluationDetailItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [showIncompatible, setShowIncompatible] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const retryingRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pollAttempt = useRef(0);
  // Campos HU-25: pueden no venir en respuestas antiguas; no se asume su existencia.
  const recovery = evaluation as (EvaluationDetailItem & Partial<RecoveryFields>) | null;
  const persistedStatus = evaluation?.status;

  useEffect(() => {
    let active = true;
    if (!id) return;
    fetchEvaluation(slug, id)
      .then((data) => {
        if (active) setEvaluation(data);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Error al cargar la evaluación.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [slug, id]);

  // CA-25.02 / CA-25.17: mientras el estado persistido sea IN_PROGRESS, consulta con espera creciente
  // y se detiene en cualquier estado final o al salir de la pantalla.
  useEffect(() => {
    if (!id || persistedStatus !== "IN_PROGRESS" || processing) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    pollAttempt.current = 0;

    function schedule() {
      timer = setTimeout(tick, nextPollDelay(pollAttempt.current));
    }
    async function tick() {
      if (!active || !id) return;
      if (typeof document !== "undefined" && document.hidden) {
        schedule();
        return;
      }
      pollAttempt.current += 1;
      try {
        const data = await fetchEvaluation(slug, id);
        if (!active) return;
        setEvaluation(data);
        if (data.status !== "IN_PROGRESS") return;
      } catch {
        // Un fallo de consulta no cambia el estado guardado; se vuelve a intentar con espera mayor.
      }
      if (active) schedule();
    }
    schedule();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [slug, id, persistedStatus, processing]);

  function focusResultHeading() {
    setTimeout(() => headingRef.current?.focus(), 0);
  }

  async function handleRetry() {
    if (!id || retryingRef.current) return;
    retryingRef.current = true;
    setRetrying(true);
    setError("");
    try {
      const updated = recovery?.retry
        ? await retryEvaluation<EvaluationDetailItem>(slug, id)
        : await processEvaluation(slug, id);
      setEvaluation(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo reintentar la consulta. Intenta nuevamente.");
    } finally {
      retryingRef.current = false;
      setRetrying(false);
      focusResultHeading();
    }
  }

  async function handleRefresh() {
    if (!id || refreshing) return;
    setRefreshing(true);
    setError("");
    try {
      setEvaluation(await fetchEvaluation(slug, id));
    } catch {
      setError("No se pudo actualizar el estado. Intenta de nuevo.");
    } finally {
      setRefreshing(false);
    }
  }

  function renderRetryControls() {
    const info = recovery?.retry;
    const allowed = info ? info.allowed : true;
    return (
      <div className="eval-retry-box">
        <button
          type="button"
          className="eval-btn-primary eval-btn-fixed"
          onClick={handleRetry}
          disabled={!allowed || retrying}
          aria-describedby={!allowed ? "eval-retry-reason" : undefined}
        >
          <RefreshCw size={18} /> {retrying ? "Reintentando…" : "Reintentar consulta"}
        </button>
        {info && allowed && (
          <span className="eval-retry-hint">
            {info.remainingAttempts === 1
              ? "Te queda 1 reintento"
              : `Te quedan ${info.remainingAttempts} reintentos`}
          </span>
        )}
        {info && !allowed && (
          <p id="eval-retry-reason" className="eval-retry-reason">
            {info.reason}
          </p>
        )}
      </div>
    );
  }

  async function handleStartProcessing() {
    if (!id) return;
    setProcessing(true);
    setError("");
    try {
      const updated = await processEvaluation(slug, id);
      setEvaluation(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo completar el procesamiento.");
    } finally {
      setProcessing(false);
    }
  }

  function formatMoney(val: number | null | undefined): string {
    if (val === null || val === undefined) return "No disponible";
    return `Bs. ${val.toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function renderProvenance(provKey: keyof ProfileIndicatorProvenanceDto) {
    const prov = evaluation?.profile?.indicatorProvenance?.[provKey];
    if (!prov) return null;
    const label =
      prov === "BANK_MOCK"
        ? "Fuente: Banco"
        : prov === "BUREAU_MOCK"
          ? "Fuente: Buró"
          : prov === "CONSOLIDATED"
            ? "Consolidado (Banco + Buró)"
            : "No disponible";
    const cls =
      prov === "BANK_MOCK"
        ? "eval-provenance-bank"
        : prov === "BUREAU_MOCK"
          ? "eval-provenance-bureau"
          : prov === "CONSOLIDATED"
            ? "eval-provenance-consolidated"
            : "eval-provenance-unavailable";
    return <span className={`eval-indicator-provenance ${cls}`}>{label}</span>;
  }

  if (loading) {
    return (
      <main className="eval-container">
        <div className="eval-card" style={{ textAlign: "center", padding: 48 }}>
          <div className="eval-spinner" />
          <p style={{ color: "#51627d" }}>Cargando datos de la evaluación...</p>
        </div>
      </main>
    );
  }

  if (error && !evaluation) {
    return (
      <main className="eval-container">
        <div className="eval-card">
          <div className="eval-client-badge" style={{ borderColor: "#fda29b", background: "#fef3f2" }}>
            <AlertCircle size={24} color="#b42318" />
            <div>
              <h3 style={{ color: "#b42318" }}>Error</h3>
              <p style={{ color: "#7a271a" }}>{error}</p>
            </div>
          </div>
          <div className="eval-actions" style={{ borderTop: "none", marginTop: 20 }}>
            <Link className="eval-btn-secondary" to={`/${slug}/evaluaciones`}>
              <ArrowLeft size={16} /> Volver a evaluaciones
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (!evaluation) return null;

  const profile = evaluation.profile;

  return (
    <main className="eval-container results-page">
      <div style={{ marginBottom: 16 }}>
        <Link
          to={backUrl}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "#1267e8",
            fontSize: 14,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          <ArrowLeft size={16} /> Volver a lista de evaluaciones
        </Link>
      </div>

      <div className="results-content">
        {/* Header Summary */}
        <div className="results-header">
          <div className="results-identity">
            <div className="eval-eyebrow">Evaluación crediticia</div>
            <h1 ref={headingRef} tabIndex={-1}>
              {evaluation.clientName}
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: "#51627d" }}>
              {evaluation.documentType}: <strong>{evaluation.documentNumber}</strong> · Finalidad:{" "}
              <strong>{PURPOSE_LABELS[evaluation.purpose] || evaluation.purpose}</strong>
            </p>
            {evaluation.clientId && (
              <div style={{ marginTop: 8 }}>
                <Link
                  to={`/${slug}/clientes/${evaluation.clientId}`}
                  state={{ from: `${location.pathname}${location.search}` }}
                  className="eval-btn-secondary"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13,
                    height: 32,
                    padding: "0 10px",
                    textDecoration: "none",
                  }}
                >
                  <User size={15} /> Ver expediente del solicitante
                </Link>
              </div>
            )}
          </div>
          <div className="results-request">
            <span className={`eval-status-badge eval-status-${evaluation.status}`}>
              {evaluation.status === "COMPLETED"
                ? "COMPLETADA"
                : evaluation.status === "IN_PROGRESS"
                  ? "EN PROCESO"
                  : evaluation.status === "INCOMPLETE"
                    ? "INFORMACIÓN PARCIAL"
                    : evaluation.status === "FAILED"
                      ? "NO COMPLETADA"
                      : "BORRADOR"}
            </span>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#0b1f4d", marginTop: 6 }}>
              Bs. {evaluation.requestedAmount.toLocaleString("es-BO", { minimumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        {/* CA-25.11: aviso accesible de cambios de estado, sin robar el foco */}
        <div className="eval-sr-only" aria-live="polite" aria-atomic="true">
          {statusAnnouncement(evaluation.status, recovery?.tracking)}
        </div>

        {/* Multi-source coverage badges (HU-15) */}
        {evaluation.sourceResults && evaluation.sourceResults.length > 0 && (
          <div className="eval-sources-container results-sources" aria-label="Fuentes consultadas">
            <span className="eval-sources-title">Fuentes consultadas:</span>
            {evaluation.sourceResults.map((sr) => (
              <span key={sr.id} className={`eval-source-badge eval-source-badge-${sr.status.toLowerCase()}`}>
                {sr.status === "SUCCESS" ? (
                  <CheckCircle2 size={13} />
                ) : sr.status === "NO_DATA" ? (
                  <AlertCircle size={13} />
                ) : (
                  <AlertTriangle size={13} />
                )}
                {sr.providerName || (sr.providerCode === "BANK_MOCK" ? "Banco Unión" : "Buró de Crédito")}:{" "}
                {sr.status === "SUCCESS"
                  ? "Disponible"
                  : sr.status === "NO_DATA"
                    ? "Sin antecedentes"
                    : sr.status === "UNAVAILABLE"
                      ? "No disponible"
                      : "Error de conexión"}
                {(() => {
                  const asOf = formatAsOf(
                    recovery?.sourceStatuses?.find(
                      (item) => item.providerCode === sr.providerCode && item.status === sr.status,
                    )?.asOf,
                  );
                  return asOf ? <span className="eval-source-date"> · consultada el {asOf}</span> : null;
                })()}
              </span>
            ))}
          </div>
        )}

        {/* Processing in flight */}
        {processing && (
          <div className="eval-processing-box" role="status">
            <div className="eval-spinner" />
            <h3 style={{ fontSize: 18, fontWeight: 700, color: "#0b1f4d", margin: "0 0 6px" }}>
              Procesando evaluación...
            </h3>
            <p style={{ margin: 0, color: "#51627d", fontSize: 14 }}>
              Consultando información financiera disponible del solicitante y calculando su perfil crediticio.
            </p>
          </div>
        )}

        {/* Error alert if processing failed */}
        {error && (
          <div
            className="eval-client-badge"
            role="alert"
            style={{ borderColor: "#fda29b", background: "#fef3f2", marginTop: 16 }}
          >
            <AlertCircle size={20} color="#b42318" />
            <p style={{ margin: 0, color: "#7a271a", fontSize: 14 }}>{error}</p>
          </div>
        )}

        {/* Estado persistido IN_PROGRESS (recarga o consulta desde otra pantalla): CA-25.02 / CA-25.17 */}
        {!processing && evaluation.status === "IN_PROGRESS" && (
          recovery?.tracking === "PROGRESS_STALLED" ? (
            <div className="eval-processing-box eval-processing-stalled">
              <AlertTriangle size={32} color="#b54708" />
              <h3 style={{ fontSize: 18, fontWeight: 700, color: "#0b1f4d", margin: "8px 0 6px" }}>
                La consulta se está demorando
              </h3>
              <p style={{ margin: "0 0 16px", color: "#51627d", fontSize: 14 }}>
                Todavía no recibimos novedades de esta consulta. Tu caso sigue guardado; actualiza el estado
                para ver si avanzó.
              </p>
              <button
                type="button"
                className="eval-btn-secondary eval-btn-fixed"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <RefreshCw size={16} /> {refreshing ? "Actualizando…" : "Actualizar estado"}
              </button>
            </div>
          ) : (
            <div className="eval-processing-box">
              <div className="eval-spinner" aria-hidden="true" />
              <h3 style={{ fontSize: 18, fontWeight: 700, color: "#0b1f4d", margin: "0 0 6px" }}>
                Consultando fuentes
              </h3>
              <p style={{ margin: 0, color: "#51627d", fontSize: 14 }}>
                Puedes salir de esta pantalla y volver: el estado de la consulta queda guardado.
              </p>
            </div>
          )
        )}

        {/* Status DRAFT view */}
        {!processing && evaluation.status === "DRAFT" && (
          <div style={{ padding: "28px 0 12px" }}>
            <div
              style={{
                background: "#f5f9fb",
                border: "1px solid #d9e4f0",
                borderRadius: 12,
                padding: 20,
                marginBottom: 20,
              }}
            >
              <h3 style={{ fontSize: 16, fontWeight: 600, color: "#0b1f4d", margin: "0 0 8px" }}>
                Expediente preparado y autorizado
              </h3>
              <p style={{ margin: 0, fontSize: 14, color: "#51627d" }}>
                El caso se encuentra en borrador con el consentimiento informado registrado. Al iniciar,
                DoggyCredit consultará automáticamente los antecedentes de las fuentes financieras habilitadas
                para derivar el perfil financiero consolidado.
              </p>
            </div>
            <IntegrationNotice slug={slug} refreshKey={evaluation.status} />
            <button className="eval-btn-primary" onClick={handleStartProcessing}>
              <TrendingUp size={18} /> Iniciar evaluación
            </button>
          </div>
        )}

        {/* Status COMPLETED: Financial Profile Dashboard */}
        {!processing && evaluation.status === "COMPLETED" && profile && (
          <div className="eval-profile-section results-profile-section">
            {/* Recommendations Section (HU-12 / HU-17) */}
            {(() => {
              const recommendations = evaluation.recommendations || [];
              const recommended = recommendations.filter((r) => r.outcome === "RECOMMENDED");
              const notEvaluable = recommendations.filter((r) => r.outcome === "NOT_EVALUABLE");
              const incompatible = recommendations.filter((r) => r.outcome === "NOT_COMPATIBLE");

              return (
                <div className="eval-recommendations-section results-recommendations-section">
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <h2
                      className="results-recommendations-heading"
                      style={{ fontWeight: 700, color: "#0b1f4d", margin: 0 }}
                    >
                      Recomendación de Productos Crediticios
                    </h2>
                    <span style={{ fontSize: 13, color: "#51627d" }}>
                      Reglas v{evaluation.ruleVersion || "1.0.0"}
                    </span>
                  </div>
                  <p style={{ fontSize: 14, color: "#51627d", margin: "0 0 16px" }}>
                    Comparación automática del perfil financiero con el catálogo de productos activos de tu
                    institución.
                  </p>

                  {/* 1. Compatible products */}
                  {recommended.length > 0 ? (
                    <div className="eval-rec-grid">
                      {recommended.map((rec, index) => (
                        <div key={rec.id} className="eval-rec-card eval-rec-card-recommended">
                          <div className="eval-rec-header">
                            <div>
                              <div
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  marginBottom: 4,
                                  flexWrap: "wrap",
                                }}
                              >
                                <h3 className="eval-rec-title">{rec.productName}</h3>
                                <span className="eval-rec-badge-secondary">
                                  {CATEGORY_NAMES[rec.category] || rec.category}
                                </span>
                                {index === 0 && recommended.length > 1 && (
                                  <span className="eval-rec-badge-primary">
                                    <Award size={13} /> Recomendación principal
                                  </span>
                                )}
                                {index > 0 && recommended.length > 1 && (
                                  <span className="eval-rec-badge-secondary">Alternativa compatible</span>
                                )}
                              </div>
                              <div className="eval-rec-meta">
                                Rango admisible: Bs. {rec.minAmount.toLocaleString("es-BO")} - Bs.{" "}
                                {rec.maxAmount.toLocaleString("es-BO")}
                              </div>
                            </div>
                            <span className="eval-rec-badge-primary">
                              <CheckCircle2 size={14} /> Compatible
                            </span>
                          </div>

                          <div style={{ borderTop: "1px solid #d9f3e4", paddingTop: 12 }}>
                            <span
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: "#027a48",
                                textTransform: "uppercase",
                                letterSpacing: "0.04em",
                              }}
                            >
                              Criterios evaluados y cumplidos
                            </span>
                            <ul className="eval-rec-reasons-list">
                              {rec.reasons.map((reason) => (
                                <li key={reason.code} className="eval-rec-reason-item eval-rec-reason-passed">
                                  <CheckCircle2
                                    size={16}
                                    color="#067647"
                                    style={{ flexShrink: 0, marginTop: 1 }}
                                  />
                                  <span>{reason.message}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="eval-no-compat-box">
                      <AlertCircle size={36} color="#b54708" />
                      <h3 style={{ fontSize: 16, fontWeight: 700, color: "#0b1f4d", margin: "0 0 6px" }}>
                        Ningún producto compatible para este perfil
                      </h3>
                      <p style={{ margin: 0, fontSize: 14, color: "#51627d" }}>
                        El perfil financiero del solicitante no cumple con los criterios de admisibilidad ni
                        parámetros de los productos crediticios activos actualmente en la institución. La
                        evaluación concluye como completada sin productos compatibles, sin registrar un
                        rechazo formal de crédito (CA-17.07, PA-17.05).
                      </p>
                    </div>
                  )}

                  {/* 2. Products not evaluable due to insufficient information (CA-17.05, CA-17.13, PA-17.04) */}
                  {notEvaluable.length > 0 && (
                    <div style={{ marginTop: 24 }}>
                      <div style={{ marginBottom: 12 }}>
                        <h3
                          style={{
                            fontSize: 15,
                            fontWeight: 700,
                            color: "#b54708",
                            margin: "0 0 4px",
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <AlertTriangle size={16} /> Productos con condiciones no comprobadas por información
                          insuficiente ({notEvaluable.length})
                        </h3>
                        <p style={{ fontSize: 13, color: "#712f06", margin: 0 }}>
                          Estos productos no se descartan como incompatibles porque la información disponible
                          en las fuentes consultadas fue insuficiente para verificar todas sus condiciones
                          (CA-17.05, CA-17.13).
                        </p>
                      </div>

                      <div className="eval-rec-grid">
                        {notEvaluable.map((rec) => (
                          <div key={rec.id} className="eval-rec-card eval-rec-card-notevaluable">
                            <div className="eval-rec-header">
                              <div>
                                <div
                                  style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 8,
                                    marginBottom: 4,
                                    flexWrap: "wrap",
                                  }}
                                >
                                  <h3 className="eval-rec-title" style={{ color: "#712f06" }}>
                                    {rec.productName}
                                  </h3>
                                  <span className="eval-rec-badge-secondary">
                                    {CATEGORY_NAMES[rec.category] || rec.category}
                                  </span>
                                </div>
                                <div className="eval-rec-meta">
                                  Rango admisible: Bs. {rec.minAmount.toLocaleString("es-BO")} - Bs.{" "}
                                  {rec.maxAmount.toLocaleString("es-BO")}
                                </div>
                              </div>
                              <span className="eval-rec-badge-notevaluable">
                                <AlertTriangle size={14} /> Condición no comprobada / Información insuficiente
                              </span>
                            </div>

                            <div style={{ borderTop: "1px solid #fedf89", paddingTop: 12 }}>
                              <span
                                style={{
                                  fontSize: 12,
                                  fontWeight: 600,
                                  color: "#b54708",
                                  textTransform: "uppercase",
                                  letterSpacing: "0.04em",
                                }}
                              >
                                Evaluación de condiciones
                              </span>
                              <ul className="eval-rec-reasons-list">
                                {rec.reasons.map((reason) => (
                                  <li
                                    key={reason.code}
                                    className={`eval-rec-reason-item ${
                                      reason.status === "NOT_EVALUABLE"
                                        ? "eval-rec-reason-notevaluable"
                                        : reason.passed
                                          ? "eval-rec-reason-passed"
                                          : "eval-rec-reason-failed"
                                    }`}
                                  >
                                    {reason.status === "NOT_EVALUABLE" ? (
                                      <AlertTriangle
                                        size={16}
                                        color="#b54708"
                                        style={{ flexShrink: 0, marginTop: 1 }}
                                      />
                                    ) : reason.passed ? (
                                      <CheckCircle2
                                        size={16}
                                        color="#067647"
                                        style={{ flexShrink: 0, marginTop: 1 }}
                                      />
                                    ) : (
                                      <XCircle
                                        size={16}
                                        color="#b42318"
                                        style={{ flexShrink: 0, marginTop: 1 }}
                                      />
                                    )}
                                    <span>{reason.message}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 3. Incompatible products */}
                  {incompatible.length > 0 && (
                    <div style={{ marginTop: 20 }}>
                      <button
                        type="button"
                        onClick={() => setShowIncompatible((prev) => !prev)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#1267e8",
                          fontSize: 14,
                          fontWeight: 600,
                          cursor: "pointer",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: 0,
                        }}
                      >
                        {showIncompatible ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        {showIncompatible
                          ? "Ocultar otros productos evaluados no compatibles"
                          : `Ver otros productos evaluados no compatibles (${incompatible.length})`}
                      </button>

                      {showIncompatible && (
                        <div className="eval-rec-grid" style={{ marginTop: 12 }}>
                          {incompatible.map((rec) => (
                            <div key={rec.id} className="eval-rec-card eval-rec-card-incompatible">
                              <div className="eval-rec-header">
                                <div>
                                  <div
                                    style={{
                                      display: "flex",
                                      alignItems: "center",
                                      gap: 8,
                                      marginBottom: 4,
                                      flexWrap: "wrap",
                                    }}
                                  >
                                    <h3 className="eval-rec-title" style={{ color: "#344054" }}>
                                      {rec.productName}
                                    </h3>
                                    <span className="eval-rec-badge-secondary">
                                      {CATEGORY_NAMES[rec.category] || rec.category}
                                    </span>
                                  </div>
                                  <div className="eval-rec-meta">
                                    Rango admisible: Bs. {rec.minAmount.toLocaleString("es-BO")} - Bs.{" "}
                                    {rec.maxAmount.toLocaleString("es-BO")}
                                  </div>
                                </div>
                                <span className="eval-rec-badge-incompatible">
                                  <XCircle size={14} /> No compatible
                                </span>
                              </div>

                              <div style={{ borderTop: "1px solid #eaecf0", paddingTop: 12 }}>
                                <span
                                  style={{
                                    fontSize: 12,
                                    fontWeight: 600,
                                    color: "#475467",
                                    textTransform: "uppercase",
                                    letterSpacing: "0.04em",
                                  }}
                                >
                                  Motivos de no compatibilidad
                                </span>
                                <ul className="eval-rec-reasons-list">
                                  {rec.reasons.map((reason) => (
                                    <li
                                      key={reason.code}
                                      className={`eval-rec-reason-item ${reason.passed ? "eval-rec-reason-passed" : "eval-rec-reason-failed"}`}
                                    >
                                      {reason.passed ? (
                                        <CheckCircle2
                                          size={16}
                                          color="#067647"
                                          style={{ flexShrink: 0, marginTop: 1 }}
                                        />
                                      ) : (
                                        <XCircle
                                          size={16}
                                          color="#b42318"
                                          style={{ flexShrink: 0, marginTop: 1 }}
                                        />
                                      )}
                                      <span>{reason.message}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="eval-disclaimer-box">
                    <ShieldCheck size={20} color="#1267e8" style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                      <strong>Aviso de recomendación:</strong> Este resultado constituye una recomendación
                      técnica preliminar de compatibilidad crediticia basada en reglas institucionales. No
                      representa una aprobación formal ni compromiso de desembolso por parte de la institución
                      (CA-17.09).
                    </span>
                  </div>
                </div>
              );
            })()}

            <div className="results-financial-panel">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <h2 style={{ fontSize: 18, fontWeight: 700, color: "#0b1f4d", margin: 0 }}>
                  Perfil Financiero{" "}
                  {evaluation.sourceResults && evaluation.sourceResults.length > 1 ? "Consolidado" : "Básico"}
                </h2>
                <span
                  style={{
                    fontSize: 13,
                    color: "#51627d",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Clock size={14} /> Calculado el {new Date(profile.calculatedAt).toLocaleDateString()}
                </span>
              </div>

              {/* Buró NO_DATA banner (CA-15.06, CA-15.13) */}
              {(() => {
                const bureauSr = evaluation.sourceResults?.find(
                  (sr) =>
                    sr.providerCode === "BUREAU_MOCK" || sr.providerName?.toLowerCase().includes("buró"),
                );
                if (bureauSr && bureauSr.status === "NO_DATA") {
                  return (
                    <div className="eval-bureau-nodata-banner" role="status">
                      <AlertCircle size={18} color="#b54708" style={{ flexShrink: 0 }} />
                      <span>
                        <strong>Sin antecedentes en Buró:</strong> El solicitante no registra historial previo
                        en el Buró de Crédito. El perfil financiero se calculó con los datos disponibles de la
                        fuente bancaria (CA-15.06, CA-15.13).
                      </span>
                    </div>
                  );
                }
                return null;
              })()}

              <div className="eval-profile-grid results-indicators">
                {/* 1. Ingreso promedio */}
                <div className="eval-indicator-card">
                  <span className="eval-indicator-label">Ingreso mensual promedio</span>
                  <span
                    className={`eval-indicator-value ${profile.averageMonthlyIncome === null ? "eval-indicator-unavailable" : ""}`}
                  >
                    {formatMoney(profile.averageMonthlyIncome)}
                  </span>
                  <span className="eval-indicator-sub">Promedio de ingresos reportados</span>
                  {renderProvenance("averageMonthlyIncome")}
                </div>

                {/* 2. Gastos promedio */}
                <div className="eval-indicator-card">
                  <span className="eval-indicator-label">Gastos mensuales promedio</span>
                  <span
                    className={`eval-indicator-value ${profile.averageMonthlyExpenses === null ? "eval-indicator-unavailable" : ""}`}
                  >
                    {formatMoney(profile.averageMonthlyExpenses)}
                  </span>
                  <span className="eval-indicator-sub">Egresos habituales registrados</span>
                  {renderProvenance("averageMonthlyExpenses")}
                </div>

                {/* 3. Ingreso disponible */}
                <div className="eval-indicator-card">
                  <span className="eval-indicator-label">Capacidad disponible</span>
                  <span
                    className={`eval-indicator-value ${profile.disposableIncome === null ? "eval-indicator-unavailable" : ""}`}
                  >
                    {formatMoney(profile.disposableIncome)}
                  </span>
                  <span className="eval-indicator-sub">Margen neto (Ingresos - Gastos)</span>
                  {renderProvenance("disposableIncome")}
                </div>

                {/* 4. Deuda total */}
                <div className="eval-indicator-card">
                  <span className="eval-indicator-label">Deuda total acumulada</span>
                  <span
                    className={`eval-indicator-value ${profile.totalDebt === null ? "eval-indicator-unavailable" : ""}`}
                  >
                    {formatMoney(profile.totalDebt)}
                  </span>
                  <span className="eval-indicator-sub">Saldo vigente de obligaciones</span>
                  {renderProvenance("totalDebt")}
                </div>

                {/* 5. Creditos activos */}
                <div className="eval-indicator-card">
                  <span className="eval-indicator-label">Créditos activos</span>
                  <span className="eval-indicator-value">
                    {profile.activeCredits !== null ? profile.activeCredits : "No disponible"}
                  </span>
                  <span className="eval-indicator-sub">Obligaciones financieras vigentes</span>
                  {renderProvenance("activeCredits")}
                </div>

                {/* 6. DTI */}
                <div className="eval-indicator-card">
                  <span className="eval-indicator-label">Relación deuda / ingreso (DTI)</span>
                  <span
                    className={`eval-indicator-value ${profile.debtToIncome === null ? "eval-indicator-unavailable" : ""}`}
                  >
                    {profile.debtToIncome !== null
                      ? `${(profile.debtToIncome * 100).toFixed(2)}%`
                      : "No disponible"}
                  </span>
                  <span className="eval-indicator-sub">Porcentaje de ingresos para pago de deuda</span>
                  {renderProvenance("debtToIncome")}
                </div>

                {/* 7. Mora reciente */}
                <div className="eval-indicator-card">
                  <span className="eval-indicator-label">Historial de mora reciente</span>
                  <span className="eval-indicator-value" style={{ fontSize: 16 }}>
                    {profile.hasRecentArrears === null ? (
                      <span className="eval-indicator-unavailable">No disponible</span>
                    ) : profile.hasRecentArrears ? (
                      <span
                        style={{ color: "#b42318", display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <AlertTriangle size={18} /> Con atrasos vigentes
                      </span>
                    ) : (
                      <span
                        style={{ color: "#067647", display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <CheckCircle2 size={18} /> Sin mora registrada
                      </span>
                    )}
                  </span>
                  <span className="eval-indicator-sub">Días de atraso en entidades financieras</span>
                  {renderProvenance("hasRecentArrears")}
                </div>

                {/* 8. Completitud */}
                <div className="eval-indicator-card">
                  <span className="eval-indicator-label">Completitud del perfil</span>
                  <span className="eval-indicator-value" style={{ color: "#1267e8" }}>
                    {(profile.completeness * 100).toFixed(0)}%
                  </span>
                  <span className="eval-indicator-sub">Indicadores calculables / evaluables</span>
                </div>
              </div>

              {/* Provenance and immutability notice */}
              <div className="eval-provenance-box">
                <Lock size={16} />
                <span>
                  Fuentes consultadas:{" "}
                  {evaluation.sourceResults && evaluation.sourceResults.length > 0
                    ? evaluation.sourceResults
                        .map(
                          (s) =>
                            s.providerName ||
                            (s.providerCode === "BANK_MOCK" ? "Banco Unión" : "Buró de Crédito"),
                        )
                        .join(", ")
                    : "Banco Unión Mock"}{" "}
                  · Perfil v{profile.profileVersion} · Lectura protegida contra edición manual (CA-15.11).
                </span>
              </div>
            </div>

            <div className="eval-actions results-actions">
              <Link className="eval-btn-primary" to={`/${slug}/evaluaciones/nueva`}>
                <Plus size={18} /> Nueva evaluación
              </Link>
              <Link className="eval-btn-secondary" to={backUrl}>
                <FileText size={18} /> Ver evaluaciones
              </Link>
            </div>
          </div>
        )}

        {/* Status INCOMPLETE: sin antecedentes (final) o fuente caída (reintentable) */}
        {!processing && evaluation.status === "INCOMPLETE" && (
          <div style={{ marginTop: 24 }}>
            <div
              className="eval-client-badge"
              style={{ borderColor: "#fedf89", background: "#fffaeb", padding: 20 }}
            >
              <AlertCircle size={28} color="#b54708" />
              <div>
                <h3 style={{ color: "#b54708", margin: "0 0 6px", fontSize: 16 }}>
                  {recovery?.tracking === "PROVIDER_ISSUE"
                    ? "Resultado parcial: faltó una fuente"
                    : "Fuente sin antecedentes disponibles"}
                </h3>
                <p style={{ color: "#712f06", margin: 0, fontSize: 14 }}>
                  {recovery?.tracking === "PROVIDER_ISSUE" && recovery.coverage
                    ? `${recovery.coverage.achieved} ${recovery.coverage.missing}`
                    : evaluation.failureMessage ||
                      "La fuente bancaria consultada no dispone de información financiera para este solicitante."}
                </p>
              </div>
            </div>
            <p style={{ fontSize: 14, color: "#51627d", marginTop: 12 }}>
              {recovery?.tracking === "PROVIDER_ISSUE" && recovery.coverage
                ? `${recovery.coverage.nextAction} Mientras falte esa fuente, el resultado es provisional y no debe usarse como definitivo.`
                : "La evaluación se cerró con información parcial debido a la ausencia de registros previos en la entidad bancaria consultada."}
            </p>
            {(recovery?.tracking === "PROVIDER_ISSUE" || (recovery?.retry && !recovery.retry.allowed)) && (
              <>
                {recovery?.tracking === "PROVIDER_ISSUE" && <IntegrationNotice slug={slug} refreshKey={evaluation.status} />}
                {renderRetryControls()}
              </>
            )}
            <div className="eval-actions" style={{ marginTop: 24 }}>
              <Link className="eval-btn-primary" to={`/${slug}/evaluaciones/nueva`}>
                <Plus size={18} /> Nueva evaluación
              </Link>
              <Link className="eval-btn-secondary" to={backUrl}>
                <FileText size={18} /> Ver evaluaciones
              </Link>
            </div>
          </div>
        )}

        {/* Status FAILED (UNAVAILABLE or ERROR) */}
        {!processing && evaluation.status === "FAILED" && (
          <div style={{ marginTop: 24 }}>
            <div
              className="eval-client-badge"
              style={{ borderColor: "#fda29b", background: "#fef3f2", padding: 20 }}
            >
              <AlertTriangle size={28} color="#b42318" />
              <div>
                <h3 style={{ color: "#b42318", margin: "0 0 6px", fontSize: 16 }}>
                  {recovery?.tracking === "FAILED"
                    ? "No se pudo completar la consulta"
                    : "Servicio no disponible temporalmente"}
                </h3>
                <p style={{ color: "#7a271a", margin: 0, fontSize: 14 }}>
                  {recovery?.coverage
                    ? `${recovery.coverage.achieved} ${recovery.coverage.missing}`
                    : evaluation.failureMessage ||
                      "Ocurrió una interrupción al consultar la fuente bancaria externa. Esta situación es reintentable."}
                </p>
              </div>
            </div>
            <p style={{ fontSize: 14, color: "#51627d", marginTop: 12 }}>
              {recovery?.coverage
                ? recovery.coverage.nextAction
                : "Puedes reintentar la operación sobre este mismo caso sin necesidad de volver a crear o capturar la información del solicitante."}
            </p>
            <IntegrationNotice slug={slug} refreshKey={evaluation.status} />
            {renderRetryControls()}
            <div className="eval-actions" style={{ marginTop: 24 }}>
              {recovery?.retry && !recovery.retry.allowed && (
                <Link className="eval-btn-primary" to={`/${slug}/evaluaciones/nueva`}>
                  <Plus size={18} /> Iniciar estudio nuevo
                </Link>
              )}
              <Link className="eval-btn-secondary" to={backUrl}>
                <FileText size={18} /> Ver evaluaciones
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
