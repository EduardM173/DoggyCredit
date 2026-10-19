import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  Database,
  House,
  Info,
  ListChecks,
  LockKeyhole,
  LogOut,
  Package,
  Settings2,
  Users,
} from "lucide-react";
import { Brand } from "../../components/Brand";
import { TeamPanel } from "./TeamPanel";
import { AnalystHome } from "./AnalystHome";
import { EvaluationWizard } from "./EvaluationWizard";
import { EvaluationsList } from "./EvaluationsList";
import { EvaluationDetail } from "./EvaluationDetail";
import { ClientDossier } from "./ClientDossier";
import { ProductsCatalogPanel } from "./ProductsCatalogPanel";
import { institutionApi, InstitutionError, type InstitutionHome } from "./api";
import "./institution.css";

type Step =
  | "home"
  | "settings"
  | "institution"
  | "source"
  | "products"
  | "team"
  | "evaluations"
  | "new-evaluation"
  | "evaluation-detail"
  | "client-dossier";
const types: Record<string, string> = {
  BANK: "Banco",
  FINANCIAL_INSTITUTION: "Financiera",
  COOPERATIVE: "Cooperativa",
  OTHER: "Otra",
};
const steps = [
  {
    key: "institution",
    label: "Revisar información de la institución",
    detail: "Confirma los datos principales de tu institución.",
    path: "institucion",
  },
  {
    key: "source",
    label: "Habilitar fuente financiera",
    detail: "Activa la fuente bancaria simulada para las evaluaciones.",
    path: "fuentes-financieras",
  },
  {
    key: "products",
    label: "Revisar productos disponibles",
    detail: "Selecciona los productos que participarán en las evaluaciones.",
    path: "productos",
  },
] as const;

export function InstitutionHomePage({ step = "home" }: { step?: Step }) {
  const { tenantSlug } = useParams();
  const navigate = useNavigate();
  const base = `/${tenantSlug ?? ""}`;
  const [home, setHome] = useState<InstitutionHome | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();
    institutionApi<InstitutionHome>(`/tenants/${encodeURIComponent(tenantSlug ?? "")}/home`, {
      signal: controller.signal,
    })
      .then((value) => {
        setHome(value);
        setName(value.tenant.name);
        setType(value.tenant.type);
        setSelected(
          (value.products ?? []).filter((product) => product.selected).map((product) => product.id),
        );
        setError("");
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setHome(null);
        if (reason instanceof InstitutionError && reason.status === 401)
          navigate(`/iniciar-sesion?returnTo=${encodeURIComponent(base)}`, { replace: true });
        else setError(reason instanceof Error ? reason.message : "No se pudo cargar el espacio.");
      });
    return () => controller.abort();
  }, [base, navigate, reload, step, tenantSlug]);

  async function submit(path: string, body: object, next: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const value = await institutionApi<InstitutionHome>(
        `/tenants/${encodeURIComponent(tenantSlug ?? "")}/${path}`,
        { body },
      );
      setHome(value);
      navigate(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar. Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }

  async function submitToggleSource(code: string, enabled: boolean) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const endpoint = code === "BUREAU_MOCK" ? "source/bureau" : "source";
      const value = await institutionApi<InstitutionHome>(
        `/tenants/${encodeURIComponent(tenantSlug ?? "")}/${endpoint}`,
        { body: { enabled } },
      );
      setHome(value);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "No se pudo actualizar la fuente. Intenta nuevamente.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    try {
      await institutionApi("/auth/logout", { body: {} });
      setHome(null);
      navigate("/iniciar-sesion", { replace: true });
    } catch {
      setError("No se pudo cerrar la sesión. Intenta nuevamente.");
      setBusy(false);
    }
  }

  if (!home || home.tenant.slug !== tenantSlug)
    return (
      <main className="institution-gate">
        {error ? (
          <section className="institution-gate-panel" aria-labelledby="institution-gate-title">
            <div className="institution-gate-brand" aria-label="DoggyCredit">
              Doggy<span>Credit</span>
            </div>
            <span className="institution-gate-icon" aria-hidden="true">
              <LockKeyhole size={26} />
            </span>
            <h1 id="institution-gate-title">No tienes acceso a esta institución</h1>
            <p className="institution-gate-description">
              No pudimos abrir este espacio con tu sesión actual. Puedes elegir otra institución o intentar de
              nuevo.
            </p>
            <p className="institution-gate-detail" role="alert">
              {error}
            </p>
            <div className="institution-gate-actions">
              <Link className="institution-gate-primary" to="/elegir-institucion">
                Mis instituciones
              </Link>
              <button className="institution-gate-secondary" onClick={() => setReload((value) => value + 1)}>
                Reintentar
              </button>
            </div>
          </section>
        ) : (
          <p role="status">Comprobando acceso...</p>
        )}
      </main>
    );

  const admin = home.membership.role === "INSTITUTION_ADMIN";
  if (admin && ["evaluations", "new-evaluation", "evaluation-detail", "client-dossier"].includes(step))
    return (
      <main className="institution-gate">
        <p>No tienes permiso para preparar evaluaciones.</p>
        <Link to={base}>Volver al inicio</Link>
      </main>
    );
  if (!admin && ["settings", "institution", "source", "products", "team"].includes(step))
    return (
      <main className="institution-gate">
        <p role="alert">No tienes permiso para administrar la institución.</p>
        <Link to={base}>Volver al inicio</Link>
      </main>
    );
  const current = steps.find((item) => !home.steps?.[item.key]);
  const selectedUsable = (home.products ?? []).some(
    (product) => selected.includes(product.id) && product.applicantScope !== "COMPANY",
  );
  const pageTitle =
    step === "institution"
      ? `Revisa la información de ${home.tenant.name}`
      : step === "source"
        ? "Habilita la fuente financiera"
        : "Selecciona los productos para las evaluaciones";

  return (
    <div className="institution-shell">
      <aside className="institution-sidebar">
        <Brand dark />
        <small>Institución</small>
        <nav aria-label="Portal institucional">
          <Link className={step === "home" ? "institution-nav-active" : ""} to={base}>
            <House size={20} />
            Inicio
          </Link>
          {admin ? (
            <>
              <Link className={step === "team" ? "institution-nav-active" : ""} to={`${base}/equipo`}>
                <Users size={20} />
                Equipo
              </Link>
              <Link
                className={
                  ["settings", "institution", "source", "products"].includes(step)
                    ? "institution-nav-active"
                    : ""
                }
                to={`${base}/configuracion`}
              >
                <Settings2 size={20} />
                Configuración
              </Link>
            </>
          ) : (
            <>
              <span className="institution-nav-heading">EVALUACIONES</span>
              <Link
                className={
                  ["evaluations", "new-evaluation", "evaluation-detail", "client-dossier"].includes(step)
                    ? "institution-nav-active"
                    : ""
                }
                to={`${base}/evaluaciones`}
              >
                <ListChecks size={20} /> Evaluaciones
              </Link>
            </>
          )}
        </nav>
        <button onClick={logout} disabled={busy}>
          <LogOut size={20} />
          Cerrar sesión
        </button>
      </aside>
      <div className="institution-workspace">
        <header className="institution-topbar">
          <div className="institution-current">
            <span className="institution-avatar">{home.tenant.name.slice(0, 2).toUpperCase()}</span>
            <strong>{home.tenant.name}</strong>
          </div>
          <div className="institution-person">
            <strong>{home.user.name}</strong>
            <small>
              {home.membership.role === "INSTITUTION_ADMIN" ? "Administrador inicial" : "Analista"}
            </small>
          </div>
        </header>
        {step === "team" ? (
          <TeamPanel slug={home.tenant.slug} tenantName={home.tenant.name} />
        ) : step === "new-evaluation" ? (
          <EvaluationWizard slug={home.tenant.slug} tenantName={home.tenant.name} ready={home.ready} />
        ) : step === "evaluations" ? (
          <EvaluationsList slug={home.tenant.slug} tenantName={home.tenant.name} ready={home.ready} />
        ) : step === "evaluation-detail" ? (
          <EvaluationDetail slug={home.tenant.slug} />
        ) : step === "client-dossier" ? (
          <ClientDossier slug={home.tenant.slug} ready={home.ready} />
        ) : !admin ? (
          <AnalystHome
            slug={home.tenant.slug}
            tenantName={home.tenant.name}
            userName={home.user.name}
            ready={home.ready}
            evaluations={false}
          />
        ) : step === "home" && home.ready ? (
          <main className="institution-dashboard">
            <p className="institution-eyebrow">INICIO</p>
            <h1>{home.tenant.name} está listo para evaluar solicitudes</h1>
            <p className="institution-lead">La preparación inicial está completa.</p>
            <section className="institution-ready">
              <Check size={28} aria-hidden="true" />
              <div>
                <h2>Tu institución está lista</h2>
                <p>Invita a un analista para comenzar a trabajar en {home.tenant.name}.</p>
                <Link className="institution-primary" to={`${base}/equipo`}>
                  <Users size={20} />
                  Invitar analista
                </Link>
              </div>
            </section>
          </main>
        ) : step === "settings" ? (
          <main className="institution-dashboard">
            <div className="institution-breadcrumb">
              <Link to={base}>Inicio</Link>
              <ArrowRight size={16} /> Configuración
            </div>
            <p className="institution-eyebrow">CONFIGURACIÓN</p>
            <h1>Configuración de {home.tenant.name}</h1>
            <p className="institution-lead">Consulta y actualiza los datos de tu institución.</p>
            <section className="institution-settings-list" aria-label="Configuración institucional">
              <Link to={`${base}/institucion`}>
                <Building2 size={25} />
                <span>
                  <strong>Institución</strong>
                  <small>Nombre, NIT y tipo de institución</small>
                </span>
                <em>{home.steps?.institution ? "Confirmada" : "Por completar"}</em>
                <ArrowRight size={20} />
              </Link>
              <Link to={`${base}/fuentes-financieras`}>
                <Database size={25} />
                <span>
                  <strong>Fuentes financieras</strong>
                  <small>Fuente disponible para evaluaciones</small>
                </span>
                <em>{home.steps?.source ? "Habilitada" : "Por completar"}</em>
                <ArrowRight size={20} />
              </Link>
              <Link to={`${base}/productos`}>
                <Package size={25} />
                <span>
                  <strong>Productos</strong>
                  <small>Productos disponibles para recomendaciones</small>
                </span>
                <em>{home.steps?.products ? "Confirmados" : "Por completar"}</em>
                <ArrowRight size={20} />
              </Link>
            </section>
          </main>
        ) : step === "home" ? (
          <main className="institution-dashboard">
            <p className="institution-eyebrow">INICIO</p>
            <h1>
              {home.ready
                ? `${home.tenant.name} está listo para evaluar solicitudes`
                : `Prepara ${home.tenant.name} para comenzar a evaluar solicitudes`}
            </h1>
            <p className="institution-lead">
              {home.ready
                ? "La preparación inicial está completa."
                : "Completa la configuración inicial. DoggyCredit ya conoce la información de tu institución, por lo que solo revisaremos lo necesario."}
            </p>
            <div className="institution-preparation-grid">
              <section className="institution-home-panel institution-steps-panel">
                <div className="institution-panel-heading">
                  <ListChecks size={30} />
                  <div>
                    <h2>Preparación inicial</h2>
                    <p>Sigue estos pasos para habilitar las evaluaciones en tu institución.</p>
                  </div>
                </div>
                <ol className="institution-steps">
                  {steps.map((item, index) => (
                    <li key={item.key}>
                      <Link
                        className={current?.key === item.key ? "current" : ""}
                        to={`${base}/${item.path}`}
                      >
                        <span className="institution-step-number">
                          {home.steps?.[item.key] ? <Check size={18} /> : index + 1}
                        </span>
                        <span>
                          <strong>{item.label}</strong>
                          <small>{item.detail}</small>
                        </span>
                        <em className={home.steps?.[item.key] ? "complete" : ""}>
                          {home.steps?.[item.key] ? "Completado" : "Por completar"}
                        </em>
                        <ArrowRight size={20} />
                      </Link>
                    </li>
                  ))}
                </ol>
                {current && admin && (
                  <Link className="institution-primary" to={`${base}/${current.path}`}>
                    {current.label}
                    <ArrowRight size={20} />
                  </Link>
                )}
                {home.ready && (
                  <Link className="institution-primary" to={`${base}/equipo`}>
                    <Users size={20} />
                    Invitar analista
                  </Link>
                )}
              </section>
              <section className="institution-home-panel institution-summary-panel">
                <div className="institution-panel-heading">
                  <span className="institution-avatar large">
                    {home.tenant.name.slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <h2>{home.tenant.name}</h2>
                    <p>Información de tu institución</p>
                  </div>
                </div>
                <dl>
                  <dt>NIT</dt>
                  <dd>{home.tenant.taxId}</dd>
                  <dt>Tipo de institución</dt>
                  <dd>{types[home.tenant.type] ?? home.tenant.type}</dd>
                </dl>
                <div className="institution-progress-label">
                  <strong>Preparación inicial</strong>
                  <span>{home.completed ?? 0} de 3 pasos completados</span>
                </div>
                <progress value={home.completed ?? 0} max={3} aria-label="Progreso de preparación" />
                <span className="institution-percent">{home.percentage ?? 0}%</span>
                <p className="institution-note">
                  <Info size={20} />
                  {home.ready
                    ? "Tu institución cumple los requisitos de preparación."
                    : "Al completar estos pasos podrás comenzar a realizar evaluaciones."}
                </p>
              </section>
            </div>
          </main>
        ) : (
          <main className="institution-dashboard">
            <div className="institution-breadcrumb">
              <Link to={base}>Inicio</Link>
              <ArrowRight size={16} />
              {home.ready && (
                <>
                  <Link to={`${base}/configuracion`}>Configuración</Link>
                  <ArrowRight size={16} />
                </>
              )}
              {step === "institution"
                ? "Institución"
                : step === "source"
                  ? "Fuentes financieras"
                  : "Productos"}
            </div>
            <p className="institution-eyebrow">CONFIGURACIÓN</p>
            <h1>{pageTitle}</h1>
            <p className="institution-lead">
              {step === "institution"
                ? "Estos datos se obtuvieron durante la incorporación. Corrige solo lo necesario."
                : step === "source"
                  ? `Activa la fuente disponible para las evaluaciones de ${home.tenant.name}.`
                  : "Elige qué productos podrán ser considerados al generar recomendaciones."}
            </p>
            <div className="institution-detail-grid">
              <section className="institution-home-panel institution-detail-panel">
                {step === "institution" && (
                  <>
                    <h2>Información de la institución</h2>
                    <div className="institution-field">
                      <label htmlFor="institution-name">Nombre o razón social</label>
                      <input
                        id="institution-name"
                        value={name}
                        maxLength={180}
                        onChange={(event) => setName(event.target.value)}
                        disabled={!admin || busy}
                      />
                    </div>
                    <div className="institution-field">
                      <strong>NIT</strong>
                      <span>{home.tenant.taxId}</span>
                      <small>Registrado durante la incorporación.</small>
                    </div>
                    <div className="institution-field">
                      <label htmlFor="institution-type">Tipo de institución</label>
                      <select
                        id="institution-type"
                        value={type}
                        onChange={(event) => setType(event.target.value)}
                        disabled={!admin || busy}
                      >
                        {Object.entries(types).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </>
                )}
                {step === "source" && (
                  <>
                    <h2>Fuentes financieras disponibles</h2>
                    <p>
                      DoggyCredit consulta las fuentes habilitadas para construir el perfil integral de los
                      solicitantes.
                    </p>
                    <div className="institution-sources-list">
                      {(home.sources && home.sources.length > 0
                        ? home.sources
                        : [
                            {
                              code: "BANK_MOCK",
                              name: "Fuente bancaria simulada",
                              kind: "BANK",
                              description:
                                "Proporciona información financiera simulada necesaria para las evaluaciones.",
                              purpose:
                                "Construcción del perfil financiero básico a partir de cuentas, balances y flujos de efectivo.",
                              coverage: "Personas y microempresas con cuentas bancarias registradas.",
                              available: home.source?.available ?? true,
                              enabled: home.source?.enabled ?? false,
                              healthStatus: "ACTIVE",
                            },
                            {
                              code: "BUREAU_MOCK",
                              name: "Buró crediticio simulado",
                              kind: "CREDIT_BUREAU",
                              description:
                                "Aporta historial crediticio consolidado, deuda global en el sistema financiero y comportamiento de mora histórico.",
                              purpose:
                                "Evaluación complementaria de riesgo crediticio, antecedentes en el sistema y morosidad.",
                              coverage:
                                "Cobertura orientada a solicitantes particulares y personas naturales.",
                              available: true,
                              enabled: false,
                              healthStatus: "ACTIVE",
                            },
                          ]
                      ).map((src) => {
                        const isBureau = src.code === "BUREAU_MOCK";
                        return (
                          <div className="institution-source" key={src.code}>
                            {isBureau ? <Building2 size={38} /> : <Database size={38} />}
                            <div className="institution-source-content">
                              <div className="institution-source-header">
                                <h3>{src.name}</h3>
                                <div className="institution-source-badges">
                                  <span
                                    className={
                                      src.enabled
                                        ? "institution-badge complete"
                                        : "institution-badge badge-neutral"
                                    }
                                  >
                                    {src.enabled ? "Habilitada para la institución" : "No habilitada"}
                                  </span>
                                  {src.globallyEnabled === false && (
                                    <span className="institution-badge badge-inactive">
                                      Deshabilitada por la plataforma
                                    </span>
                                  )}
                                  <span
                                    className={
                                      src.available && src.healthStatus === "ACTIVE"
                                        ? "institution-badge complete"
                                        : src.healthStatus === "DEGRADED"
                                          ? "institution-badge badge-degraded"
                                          : "institution-badge badge-inactive"
                                    }
                                  >
                                    {src.available && src.healthStatus === "ACTIVE"
                                      ? "Salud técnica: Operativa"
                                      : src.healthStatus === "DEGRADED"
                                        ? "Salud técnica: Degradada"
                                        : "Salud técnica: No disponible"}
                                  </span>
                                </div>
                              </div>
                              <p>{src.description}</p>
                              <div className="institution-source-purpose">
                                <strong>Propósito:</strong> {src.purpose}
                              </div>
                              <div className="institution-source-coverage">
                                <Info size={16} />
                                <span>
                                  <strong>Limitación de cobertura:</strong> {src.coverage}
                                </span>
                              </div>
                              {admin && (
                                <div className="institution-source-actions">
                                  {!src.available ? (
                                    <div className="institution-source-unavailable-msg" role="status">
                                      {src.globallyEnabled === false
                                        ? "La plataforma deshabilitó esta fuente para nuevas consultas. Tu configuración se conserva y las evaluaciones anteriores no cambian."
                                        : "Esta fuente no se encuentra disponible actualmente en la plataforma o para tu plan."}
                                    </div>
                                  ) : isBureau ? (
                                    <button
                                      type="button"
                                      className={
                                        src.enabled
                                          ? "institution-secondary-button"
                                          : "institution-primary-button"
                                      }
                                      disabled={busy}
                                      onClick={() => submitToggleSource(src.code, !src.enabled)}
                                    >
                                      {busy
                                        ? "Actualizando..."
                                        : src.enabled
                                          ? "Deshabilitar Buró Mock"
                                          : "Habilitar Buró Mock"}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      className={
                                        src.enabled
                                          ? "institution-secondary-button"
                                          : "institution-primary-button"
                                      }
                                      disabled={busy}
                                      onClick={() => submitToggleSource(src.code, !src.enabled)}
                                    >
                                      {busy
                                        ? "Actualizando..."
                                        : src.enabled
                                          ? "Fuente bancaria habilitada"
                                          : "Habilitar fuente bancaria"}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <h3>Condiciones de integración y cobertura</h3>
                    <p className="institution-note">
                      <Info size={20} />
                      <strong>Sin configuraciones técnicas:</strong> No necesitas introducir URLs, claves de
                      API, secretos ni configurar timeouts. Toda la comunicación está encapsulada internamente
                      por DoggyCredit.
                    </p>
                    <p className="institution-note">
                      <Info size={20} />
                      <strong>Disponibilidad de antecedentes:</strong> La habilitación autoriza la consulta
                      institucional, pero no garantiza que existan antecedentes para cada solicitante. Cuando
                      una fuente no posea información, el sistema continuará reportando ausencia de datos (Sin
                      datos) sin interrumpir la evaluación.
                    </p>
                  </>
                )}
                {step === "products" && (
                  <ProductsCatalogPanel
                    slug={home.tenant.slug}
                    tenantName={home.tenant.name}
                    admin={admin}
                    initialProducts={home.products}
                    selectedProductIds={selected}
                    onSelectProduct={(id) =>
                      setSelected((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
                    }
                    onProductsChanged={() => setReload((v) => v + 1)}
                  />
                )}
              </section>
              <aside className="institution-help-panel">
                <Info size={26} />
                <div>
                  <h2>
                    {step === "institution"
                      ? "¿Por qué revisamos esta información?"
                      : step === "source"
                        ? "¿Por qué necesitamos una fuente financiera?"
                        : "¿Por qué seleccionamos estos productos?"}
                  </h2>
                  <p>
                    {step === "institution"
                      ? "Estos datos identifican a tu institución en las evaluaciones y resultados de DoggyCredit."
                      : step === "source"
                        ? "DoggyCredit utiliza información financiera para construir el perfil de los solicitantes."
                        : "DoggyCredit comparará el perfil y la necesidad del solicitante únicamente con los productos seleccionados."}
                  </p>
                  <p>
                    {step === "institution"
                      ? "Puedes corregir el nombre o el tipo de institución. El NIT se mantiene sin cambios."
                      : step === "source"
                        ? "En esta etapa se utilizará una fuente bancaria simulada para el entorno académico."
                        : "Esta selección no modifica las condiciones comerciales de los productos."}
                  </p>
                </div>
              </aside>
            </div>
            <footer className="institution-actionbar">
              <Link
                to={
                  home.ready
                    ? `${base}/configuracion`
                    : step === "institution"
                      ? base
                      : step === "source"
                        ? `${base}/institucion`
                        : `${base}/fuentes-financieras`
                }
              >
                <ArrowLeft size={20} />
                Volver
              </Link>
              {admin &&
                (step === "institution" ? (
                  <button
                    className="institution-primary"
                    disabled={busy || !name.trim()}
                    onClick={() =>
                      submit(
                        "institution",
                        { name, type },
                        home.ready ? `${base}/configuracion` : `${base}/fuentes-financieras`,
                      )
                    }
                  >
                    {busy
                      ? "Guardando..."
                      : home.ready
                        ? "Guardar cambios"
                        : "Confirmar información y continuar"}
                    <ArrowRight size={20} />
                  </button>
                ) : step === "source" ? (
                  <div className="institution-actionbar-buttons">
                    <Link className="institution-secondary-link" to={`${base}/productos`}>
                      Ir a productos
                    </Link>
                    {!home.ready && (
                      <button
                        className="institution-primary"
                        disabled={busy || !home.source?.available}
                        onClick={() => submit("source", {}, `${base}/productos`)}
                      >
                        {busy
                          ? "Habilitando..."
                          : home.source?.enabled
                            ? "Continuar a productos"
                            : "Habilitar fuente y continuar"}
                        <ArrowRight size={20} />
                      </button>
                    )}
                  </div>
                ) : (
                  <button
                    className="institution-primary"
                    disabled={busy || !selectedUsable}
                    onClick={() =>
                      submit(
                        "products",
                        { productIds: selected },
                        home.ready ? `${base}/configuracion` : base,
                      )
                    }
                  >
                    {busy
                      ? "Guardando..."
                      : home.ready
                        ? "Guardar selección"
                        : "Confirmar productos y finalizar preparación"}
                    <ArrowRight size={20} />
                  </button>
                ))}
            </footer>
          </main>
        )}
        {error && (
          <p role="alert" className="institution-error institution-page-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
