import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  CreditCard,
  Clock3,
  Lock,
  ShieldCheck,
  Users,
} from "lucide-react";
import { adminApi, AdminError, displayDate, type TenantOperationalDetail } from "./api";

export function InstitutionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [data, setData] = useState<TenantOperationalDetail | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    adminApi<TenantOperationalDetail>(`/institutions/${id}`, { signal: controller.signal })
      .then((detail) => {
        if (!controller.signal.aborted) {
          setData(detail);
        }
      })
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (e instanceof AdminError && e.status === 401) navigate("/admin/login", { replace: true });
        else setError(e instanceof Error ? e.message : "No se pudo cargar el resumen de la institución.");
      });
    return () => controller.abort();
  }, [id, attempt, navigate]);

  function retry() {
    setData(null);
    setError("");
    setAttempt((a) => a + 1);
  }

  if (!data && !error) {
    return (
      <main className="admin-page-loading" role="status">
        <p>Cargando resumen operativo de la institución...</p>
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="admin-empty">
        <p role="alert">{error || "Institución no encontrada."}</p>
        <button className="button admin-secondary" onClick={retry}>
          Reintentar
        </button>
        <Link to="/admin/instituciones" className="admin-back-link">
          <ArrowLeft size={16} /> Volver a instituciones
        </Link>
      </main>
    );
  }

  const { institution, subscription, plan, capacity, cycle, membershipsSummary, integrations } = data;
  const degradedIntegrations = integrations.filter((i) => i.hasIssue);

  return (
    <>
      <nav className="admin-breadcrumb" aria-label="Navegación contextual">
        <Link to={`/admin/instituciones${location.state?.from || ""}`}>Instituciones</Link>
        <span>/</span>
        <span aria-current="page">{institution.institutionName}</span>
      </nav>

      <header className="admin-detail-heading">
        <div>
          <div className="institution-title-row">
            <h1>{institution.institutionName}</h1>
            <span className={`admin-status status-${institution.status}`}>
              {institution.status === "ACTIVE" ? "Activa" : institution.status}
            </span>
          </div>
          <p className="admin-subheading">
            NIT: <strong>{institution.taxId}</strong> · Slug: <code>{institution.slug}</code> · Alta:{" "}
            {institution.approvedAt ? displayDate(institution.approvedAt) : "No registrada"}
          </p>
        </div>
        <Link to={`/admin/instituciones${location.state?.from || ""}`} className="button admin-secondary button-sm">
          <ArrowLeft size={16} /> Volver al listado
        </Link>
      </header>

      {/* CA-22.05, CA-22.11: Banner de Privacidad y Secreto Bancario */}
      <section className="privacy-guarantee-banner" role="region" aria-label="Garantía de privacidad operativa">
        <ShieldCheck size={20} className="privacy-icon" />
        <div>
          <strong>Privacidad Operativa y Secreto Bancario (RF-05 / CA-22.05)</strong>
          <p>
            Esta vista supervisa exclusivamente capacidades, consumo agregado e infraestructura técnica. No expone
            expedientes de crédito, números de documento de solicitantes, ingresos, deudas ni dictámenes individuales.
          </p>
        </div>
      </section>

      {/* CA-22.01, CA-22.06: Alerta priorizada si hay integraciones degradadas */}
      {degradedIntegrations.length > 0 && (
        <section className="admin-alert admin-alert-warning" role="alert">
          <AlertTriangle size={20} />
          <div>
            <strong>Degradación observada en integraciones:</strong>{" "}
            {degradedIntegrations.map((i) => i.providerName).join(", ")}. Las evaluaciones iniciadas por esta
            institución podrían verse afectadas.
          </div>
        </section>
      )}

      {/* Grid de Resumen Operativo */}
      <div className="operational-summary-grid">
        {/* Card 1: Plan y Consumo RF-03 */}
        <section className="admin-card operational-card" aria-label="Plan contratado y consumo de cuota">
          <div className="card-header">
            <CreditCard size={20} />
            <h2>Plan y Consumo de Cuota</h2>
          </div>
          <div className="card-body">
            <div className="stat-highlight">
              <span className="stat-label">Plan contratado</span>
              <strong className="stat-value">{plan?.name ?? "Sin plan activo"}</strong>
              <small className="stat-sub">
                Suscripción: {subscription.status === "ACTIVE" ? "Vigente" : subscription.status}
              </small>
            </div>

            <div className="capacity-section">
              <div className="capacity-numbers">
                <span>Evaluaciones consumidas en el ciclo:</span>
                <strong>
                  {capacity.consumed} / {capacity.limit !== null ? capacity.limit : "Ilimitadas"}
                </strong>
              </div>

              {capacity.limit !== null && (
                <div className="capacity-progress-track">
                  <div
                    className={`capacity-progress-fill ${capacity.isExceeded ? "fill-danger" : ""}`}
                    style={{ width: `${Math.min(100, capacity.percentage ?? 0)}%` }}
                    role="progressbar"
                    aria-valuenow={capacity.consumed}
                    aria-valuemin={0}
                    aria-valuemax={capacity.limit}
                  />
                </div>
              )}

              <p className="capacity-policy-note">
                {capacity.state === "ILIMITADO"
                  ? "Este plan dispone de cuota ilimitada de evaluaciones."
                  : capacity.isExceeded
                    ? "Cuota mensual alcanzada. Nuevas evaluaciones serán rechazadas preventivamente según política RF-03."
                    : `Restan ${capacity.remaining ?? 0} evaluaciones en el ciclo mensual actual.`}
              </p>
            </div>

            <div className="cycle-metadata">
              <Clock3 size={16} />
              <span>
                Ciclo vigente: {new Date(cycle.startDate).toLocaleDateString("es-BO")} al{" "}
                {new Date(cycle.endDate).toLocaleDateString("es-BO")} ({cycle.timezone})
              </span>
            </div>
          </div>
        </section>

        {/* Card 2: Salud de Integraciones HU-23 */}
        <section className="admin-card operational-card" aria-label="Salud de fuentes financieras">
          <div className="card-header">
            <Activity size={20} />
            <h2>Fuentes e Integraciones</h2>
          </div>
          <div className="card-body">
            {integrations.length === 0 ? (
              <p className="text-muted">No hay fuentes financieras configuradas para esta institución.</p>
            ) : (
              <ul className="tenant-integrations-list">
                {integrations.map((item) => (
                  <li key={item.providerCode} className={`integration-item ${item.hasIssue ? "item-degraded" : ""}`}>
                    <div className="integration-item-info">
                      <strong>{item.providerName}</strong>
                      <span className={`admin-status health-${item.healthState}`}>
                        {item.healthLabel}
                      </span>
                    </div>
                    {item.hasIssue ? (
                      <Link
                        to={`/admin/integraciones/${item.providerCode}`}
                        className="button admin-secondary button-sm"
                      >
                        Ver problema (HU-23)
                      </Link>
                    ) : (
                      <Link
                        to={`/admin/integraciones/${item.providerCode}`}
                        className="degraded-quick-link"
                      >
                        Diagnóstico
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Card 3: Equipo y Membresías */}
        <section className="admin-card operational-card span-full" aria-label="Equipo institucional">
          <div className="card-header">
            <Users size={20} />
            <h2>Equipo y Membresías Institucionales ({membershipsSummary.totalUsers})</h2>
          </div>
          <div className="card-body">
            <div className="team-stats-row">
              <div className="team-stat-chip">
                <span>Administradores</span>
                <strong>{membershipsSummary.adminsCount}</strong>
              </div>
              <div className="team-stat-chip">
                <span>Analistas de Crédito</span>
                <strong>{membershipsSummary.analystsCount}</strong>
              </div>
            </div>

            <div className="admin-table-scroll">
              <table className="admin-list-table">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Correo</th>
                    <th>Rol institucional</th>
                    <th>Estado</th>
                    <th>Fecha de alta</th>
                  </tr>
                </thead>
                <tbody>
                  {membershipsSummary.members.map((member) => (
                    <tr key={member.id}>
                      <td>
                        <strong>{member.fullName}</strong>
                        {member.isInitialAdmin && <span className="initial-admin-badge">Inicial</span>}
                      </td>
                      <td>{member.email}</td>
                      <td>
                        {member.role === "INSTITUTION_ADMIN" ? "Administrador" : "Analista de Crédito"}
                      </td>
                      <td>
                        <span className={`admin-status activation-${member.status}`}>
                          {member.status === "ACTIVE"
                            ? "Activa"
                            : member.status === "INVITED"
                              ? "Invitación pendiente"
                              : "Suspendida"}
                        </span>
                      </td>
                      <td>{displayDate(member.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="security-notice">
              <Lock size={14} /> Las credenciales de acceso y tokens de invitación no son visibles para operadores
              (CA-22.10).
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
