import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock,
  FileText,
  Lock,
  Plus,
  ShieldCheck,
  User,
} from "lucide-react";
import { fetchClientDossier, type ClientDossierDto } from "./api";
import "./evaluations.css";
import "./ClientDossier.css";

const PURPOSE_LABELS: Record<string, string> = {
  WORKING_CAPITAL: "Capital de trabajo",
  BUSINESS_INVESTMENT: "Inversión empresarial",
  GREEN_PROJECT: "Proyecto verde / sostenible",
  EQUIPMENT: "Maquinaria y equipamiento",
  OTHER: "Otra finalidad",
};

export function ClientDossier({
  slug,
  ready,
}: {
  slug: string;
  ready: boolean;
}) {
  const { clientId } = useParams<{ clientId: string }>();
  const location = useLocation();
  const backUrl = (location.state as { from?: string } | null)?.from || `/${slug}/evaluaciones`;

  const [dossier, setDossier] = useState<ClientDossierDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    if (!clientId) return;

    fetchClientDossier(slug, clientId)
      .then((data) => {
        if (!active) return;
        setDossier(data);
        setError("");
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Error al cargar el expediente.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [slug, clientId]);

  const renderStatusBadge = (status: string) => {
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

  const getActionLabel = (status: string) => {
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

  const formatMoney = (val: number | null | undefined) => {
    if (val === null || val === undefined) return "No disponible";
    return `Bs. ${val.toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  if (loading) {
    return (
      <main className="eval-container">
        <div className="eval-card" style={{ textAlign: "center", padding: 48 }}>
          <div className="eval-spinner" />
          <p style={{ color: "#51627d" }}>Cargando expediente del solicitante...</p>
        </div>
      </main>
    );
  }

  if (error || !dossier) {
    return (
      <main className="eval-container">
        <div style={{ marginBottom: 16 }}>
          <Link
            to={backUrl}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#1267e8", fontSize: 14, fontWeight: 600, textDecoration: "none" }}
          >
            <ArrowLeft size={16} /> Volver a evaluaciones
          </Link>
        </div>
        <div className="eval-card" style={{ textAlign: "center", padding: 48 }}>
          <AlertCircle size={40} color="#b42318" style={{ margin: "0 auto 12px" }} />
          <h2 style={{ fontSize: 20, margin: "0 0 8px", color: "#0b1f4d" }}>Expediente no disponible</h2>
          <p style={{ color: "#b42318", maxWidth: 440, margin: "0 auto 20px" }}>
            {error || "El expediente solicitado no existe o no pertenece a esta institución."}
          </p>
          <Link className="eval-btn-secondary" to={`/${slug}/evaluaciones`}>
            Volver a la lista de evaluaciones
          </Link>
        </div>
      </main>
    );
  }

  const { client, evaluations, latestFinancialProfile } = dossier;
  const isCompany = client.type === "COMPANY";

  return (
    <main className="eval-container dossier-page">
      <div className="institution-breadcrumb dossier-breadcrumb">
        <Link to={`/${slug}`}>Inicio</Link>
        <ArrowRight size={16} />
        <Link to={`/${slug}/evaluaciones`}>Evaluaciones</Link>
        <ArrowRight size={16} />
        <span>Expediente</span>
      </div>

      <div className="dossier-back">
        <Link
          to={backUrl}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#1267e8", fontSize: 14, fontWeight: 600, textDecoration: "none" }}
        >
          <ArrowLeft size={16} /> Volver
        </Link>
      </div>

      <div className="dossier-content">
        {/* Header Summary */}
        <div className="dossier-header">
          <div className="dossier-identity">
            <div className="eval-eyebrow">
              {isCompany ? "EXPEDIENTE EMPRESARIAL" : "EXPEDIENTE DE PERSONA NATURAL"}
            </div>
            <h1>
              {isCompany ? <Building2 size={26} color="#1267e8" /> : <User size={26} color="#1267e8" />}
              {client.name}
            </h1>
            <p style={{ margin: 0, fontSize: 14, color: "#51627d" }}>
              {client.documentType}: <strong>{client.documentNumber}</strong> · Registrado el{" "}
              {new Date(client.createdAt).toLocaleDateString("es-BO")}
            </p>
          </div>

          <div className="dossier-header-action">
            {ready && (
              <Link
                className="eval-btn-primary"
                to={`/${slug}/evaluaciones/nueva`}
                state={{
                  prefill: {
                    clientType: client.type,
                    documentType: client.documentType,
                    documentNumber: client.documentNumber,
                    name: client.name,
                    economicActivity: client.economicActivity || "",
                  },
                }}
              >
                <Plus size={18} /> Nueva evaluación
              </Link>
            )}
          </div>
        </div>

        {/* Section 1: Current Declared Information (CA-19.01, CA-19.02, CA-19.03) */}
        <section className="dossier-section">
          <h2>
            Datos declarados del solicitante (vigentes)
          </h2>

          <div className="eval-profile-grid dossier-fields">
            <div className="eval-indicator-card">
              <span className="eval-indicator-label">Razón social / Nombre</span>
              <span className="eval-indicator-value">{client.name}</span>
              <span className="eval-indicator-sub">Identificación legal principal</span>
            </div>

            <div className="eval-indicator-card">
              <span className="eval-indicator-label">Documento de identidad</span>
              <span className="eval-indicator-value">
                {client.documentType}: {client.documentNumber}
              </span>
              <span className="eval-indicator-sub">Número oficial registrado</span>
            </div>

            <div className="eval-indicator-card">
              <span className="eval-indicator-label">Tipo de solicitante</span>
              <span className="eval-indicator-value">
                {isCompany ? "Empresa / Persona Jurídica" : "Persona Natural"}
              </span>
              <span className="eval-indicator-sub">Alcance de sujeto crediticio</span>
            </div>

            <div className="eval-indicator-card">
              <span className="eval-indicator-label">Actividad económica</span>
              <span className="eval-indicator-value">
                {client.economicActivity || "No registrada"}
              </span>
              <span className="eval-indicator-sub">Rubro comercial declarado</span>
            </div>

            <div className="eval-indicator-card">
              <span className="eval-indicator-label">Correo electrónico</span>
              <span className="eval-indicator-value">
                {client.email || "No registrado"}
              </span>
              <span className="eval-indicator-sub">Contacto digital</span>
            </div>

            <div className="eval-indicator-card">
              <span className="eval-indicator-label">Teléfono de contacto</span>
              <span className="eval-indicator-value">
                {client.phone || "No registrado"}
              </span>
              <span className="eval-indicator-sub">Contacto telefónico</span>
            </div>

            <div className="eval-indicator-card">
              <span className="eval-indicator-label">Dirección declarada</span>
              <span className="eval-indicator-value">
                {client.address || "No registrada"}
              </span>
              <span className="eval-indicator-sub">Domicilio registrado</span>
            </div>
          </div>

          <div className="eval-provenance-box dossier-note">
            <Lock size={16} />
            <span>
              <strong>Consulta protegida:</strong> Información declarada actual del expediente. Esta vista es de solo
              lectura para preservar la trazabilidad e inmutabilidad de evaluaciones crediticias pasadas (CA-19.02, CA-19.03).
            </span>
          </div>
        </section>

        {/* Section 2: Linked Credit Evaluations (CA-19.04, CA-19.05, PA-19.01, PA-19.02) */}
        <section className="dossier-section">
          <div className="dossier-section-heading">
            <h2>
              Evaluaciones crediticias vinculadas ({evaluations.length})
            </h2>
            <span style={{ fontSize: 13, color: "#51627d" }}>
              Historial trazable en la entidad
            </span>
          </div>

          {evaluations.length === 0 ? (
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 24, textAlign: "center" }}>
              <FileText size={32} color="#667085" style={{ margin: "0 auto 8px" }} />
              <p style={{ margin: 0, fontSize: 14, color: "#51627d" }}>
                Este solicitante aún no tiene evaluaciones crediticias registradas en esta institución.
              </p>
            </div>
          ) : (
            <div className="dossier-table-wrap" role="region" aria-label="Evaluaciones crediticias vinculadas" tabIndex={0}>
              <table className="eval-list-table" style={{ margin: 0 }}>
                <thead>
                  <tr>
                    <th>Finalidad</th>
                    <th>Monto solicitado</th>
                    <th>Estado</th>
                    <th>Productos compatibles</th>
                    <th>Fecha</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {evaluations.map((ev) => (
                    <tr key={ev.id}>
                      <td>{PURPOSE_LABELS[ev.purpose] || ev.purpose}</td>
                      <td style={{ fontWeight: 600 }}>
                        Bs. {ev.requestedAmount.toLocaleString("es-BO", { minimumFractionDigits: 2 })}
                      </td>
                      <td>{renderStatusBadge(ev.status)}</td>
                      <td>
                        {ev.status === "COMPLETED" ? (
                          ev.compatibleProductsCount > 0 ? (
                            <span style={{ color: "#067647", fontWeight: 600, fontSize: 13 }}>
                              {ev.compatibleProductsCount} compatible{ev.compatibleProductsCount > 1 ? "s" : ""}
                            </span>
                          ) : (
                            <span style={{ color: "#b54708", fontSize: 13 }}>Sin productos compatibles</span>
                          )
                        ) : (
                          <span style={{ color: "#667085", fontSize: 13 }}>-</span>
                        )}
                      </td>
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
            </div>
          )}

          <p className="dossier-history-note">
            Los resultados y condiciones de cada caso corresponden a su snapshot histórico congelado (CA-19.04, PA-19.02).
          </p>
        </section>

        {/* Section 3: External Financial Indicators (CA-19.02, CA-19.07, PA-19.03) */}
        <section className="dossier-section">
          <h2>
            Antecedentes e indicadores de fuentes financieras
          </h2>

          {latestFinancialProfile ? (
            <>
              <div className="eval-profile-grid dossier-fields dossier-financial-fields">
                <div className="eval-indicator-card">
                  <span className="eval-indicator-label">Ingreso mensual promedio</span>
                  <span className={`eval-indicator-value ${latestFinancialProfile.averageMonthlyIncome === null ? "eval-indicator-unavailable" : ""}`}>
                    {formatMoney(latestFinancialProfile.averageMonthlyIncome)}
                  </span>
                  <span className="eval-indicator-sub">Calculado de fuentes habilitadas</span>
                </div>

                <div className="eval-indicator-card">
                  <span className="eval-indicator-label">Gastos mensuales promedio</span>
                  <span className={`eval-indicator-value ${latestFinancialProfile.averageMonthlyExpenses === null ? "eval-indicator-unavailable" : ""}`}>
                    {formatMoney(latestFinancialProfile.averageMonthlyExpenses)}
                  </span>
                  <span className="eval-indicator-sub">Estimación de egresos recurrentes</span>
                </div>

                <div className="eval-indicator-card">
                  <span className="eval-indicator-label">Capacidad disponible</span>
                  <span className={`eval-indicator-value ${latestFinancialProfile.disposableIncome === null ? "eval-indicator-unavailable" : ""}`}>
                    {formatMoney(latestFinancialProfile.disposableIncome)}
                  </span>
                  <span className="eval-indicator-sub">Margen mensual neto</span>
                </div>

                <div className="eval-indicator-card">
                  <span className="eval-indicator-label">Deuda total acumulada</span>
                  <span className={`eval-indicator-value ${latestFinancialProfile.totalDebt === null ? "eval-indicator-unavailable" : ""}`}>
                    {formatMoney(latestFinancialProfile.totalDebt)}
                  </span>
                  <span className="eval-indicator-sub">Obligaciones en sistema financiero</span>
                </div>

                <div className="eval-indicator-card">
                  <span className="eval-indicator-label">Créditos activos</span>
                  <span className="eval-indicator-value">
                    {latestFinancialProfile.activeCredits !== null ? latestFinancialProfile.activeCredits : "No disponible"}
                  </span>
                  <span className="eval-indicator-sub">Obligaciones vigentes</span>
                </div>

                <div className="eval-indicator-card">
                  <span className="eval-indicator-label">Relación deuda/ingreso (DTI)</span>
                  <span className={`eval-indicator-value ${latestFinancialProfile.debtToIncome === null ? "eval-indicator-unavailable" : ""}`}>
                    {latestFinancialProfile.debtToIncome !== null
                      ? `${(latestFinancialProfile.debtToIncome * 100).toFixed(2)}%`
                      : "No disponible"}
                  </span>
                  <span className="eval-indicator-sub">Carga financiera reportada</span>
                </div>

                <div className="eval-indicator-card">
                  <span className="eval-indicator-label">Historial de mora reciente</span>
                  <span className="eval-indicator-value" style={{ fontSize: 16 }}>
                    {latestFinancialProfile.hasRecentArrears === null ? (
                      <span className="eval-indicator-unavailable">No disponible</span>
                    ) : latestFinancialProfile.hasRecentArrears ? (
                      <span style={{ color: "#b42318", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <AlertTriangle size={18} /> Con atrasos vigentes
                      </span>
                    ) : (
                      <span style={{ color: "#067647", display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <CheckCircle2 size={18} /> Sin mora registrada
                      </span>
                    )}
                  </span>
                  <span className="eval-indicator-sub">Comportamiento en entidades</span>
                </div>
              </div>

              <div className="eval-provenance-box dossier-note">
                <ShieldCheck size={16} />
                <span>
                  <strong>Dato financiero protegido:</strong> Indicadores derivados automáticamente de fuentes simuladas (Banco y Buró).
                  Información técnica de solo lectura no sustituible por valores editables manualmente (PA-19.03).
                </span>
              </div>
            </>
          ) : (
            <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: 20 }}>
              <p style={{ margin: 0, fontSize: 14, color: "#51627d" }}>
                El solicitante aún no cuenta con antecedentes financieros calculados de fuentes en evaluaciones completadas (CA-19.07).
              </p>
            </div>
          )}
        </section>

        {/* Footer actions */}
        <div className="eval-actions dossier-actions">
          <Link className="eval-btn-secondary" to={backUrl}>
            <ArrowLeft size={16} /> Volver
          </Link>
          {ready && (
            <Link
              className="eval-btn-primary"
              to={`/${slug}/evaluaciones/nueva`}
              state={{
                prefill: {
                  clientType: client.type,
                  documentType: client.documentType,
                  documentNumber: client.documentNumber,
                  name: client.name,
                  economicActivity: client.economicActivity || "",
                },
              }}
            >
              <Plus size={18} /> Iniciar nueva evaluación
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
