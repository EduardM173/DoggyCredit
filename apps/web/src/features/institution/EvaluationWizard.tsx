import { useEffect, useState } from "react";
import { IntegrationNotice } from "./IntegrationNotice";
import { Link, useLocation } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  FileText,
  Plus,
  Search,
  ShieldCheck,
  TrendingUp,
  User,
  UserCheck,
} from "lucide-react";
import {
  institutionApi,
  InstitutionError,
  evaluationOperationKey,
  clearEvaluationOperationKey,
  type ClientSearchResult,
  type CreateEvaluationPayload,
  type EvaluationItem,
  type EvaluationReadiness,
} from "./api";
import "./evaluations.css";

const PURPOSE_LABELS: Record<string, string> = {
  WORKING_CAPITAL: "Capital de trabajo",
  BUSINESS_INVESTMENT: "Inversión empresarial",
  GREEN_PROJECT: "Proyecto verde / sostenible",
  EQUIPMENT: "Maquinaria y equipamiento",
  OTHER: "Otra finalidad",
};

export function EvaluationWizard({
  slug,
  tenantName,
  ready,
  initialReadiness,
}: {
  slug: string;
  tenantName: string;
  ready: boolean;
  initialReadiness?: EvaluationReadiness;
}) {
  const location = useLocation();
  const prefill = (
    location.state as {
      prefill?: {
        clientType: "PERSON" | "COMPANY";
        documentType: string;
        documentNumber: string;
        name: string;
        economicActivity: string;
      };
    } | null
  )?.prefill;

  const [readiness, setReadiness] = useState<EvaluationReadiness | null>(initialReadiness ?? null);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [applicantType, setApplicantType] = useState<"PERSON" | "COMPANY">(
    prefill?.clientType === "COMPANY" ? "COMPANY" : "PERSON",
  );
  const [documentNumber, setDocumentNumber] = useState(prefill?.documentNumber || "");
  const [name, setName] = useState(prefill?.name || "");
  const [economicActivity, setEconomicActivity] = useState(prefill?.economicActivity || "");
  const [isExistingClient, setIsExistingClient] = useState(Boolean(prefill));
  const [searchDone, setSearchDone] = useState(Boolean(prefill));
  const [searching, setSearching] = useState(false);

  const [purpose, setPurpose] = useState<
    "WORKING_CAPITAL" | "GREEN_PROJECT" | "BUSINESS_INVESTMENT" | "EQUIPMENT" | "OTHER"
  >("WORKING_CAPITAL");
  const [requestedAmount, setRequestedAmount] = useState<number | "">(10000);

  const [consentGiven, setConsentGiven] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdEvaluation, setCreatedEvaluation] = useState<EvaluationItem | null>(null);

  // Fetch full readiness when ready and not provided initially
  useEffect(() => {
    if (ready && !initialReadiness) {
      institutionApi<EvaluationReadiness>(`/tenants/${encodeURIComponent(slug)}/evaluations/readiness`)
        .then((data) => setReadiness(data))
        .catch(() => {});
    }
  }, [ready, slug, initialReadiness]);

  const isCompanySupported = readiness?.supportedApplicantTypes
    ? readiness.supportedApplicantTypes.COMPANY.supported
    : true;
  const companyReason = readiness?.supportedApplicantTypes?.COMPANY.reason;

  function handleSelectApplicantType(type: "PERSON" | "COMPANY") {
    if (type === applicantType) return;
    setApplicantType(type);
    setDocumentNumber("");
    setName("");
    setEconomicActivity("");
    setIsExistingClient(false);
    setSearchDone(false);
    // CA-14.08: Changing applicant subject or type resets consent!
    setConsentGiven(false);
    setError("");
  }

  // Search client by CI or NIT in the tenant
  async function handleSearch() {
    const trimmed = documentNumber.trim();
    if (!trimmed || trimmed.length < 3) {
      setError(
        applicantType === "COMPANY"
          ? "Introduce un NIT válido de al menos 3 caracteres."
          : "Introduce un número de documento válido de al menos 3 dígitos.",
      );
      return;
    }
    setSearching(true);
    setError("");
    try {
      const docType = applicantType === "COMPANY" ? "NIT" : "CI";
      const result = await institutionApi<ClientSearchResult>(
        `/tenants/${encodeURIComponent(slug)}/evaluations/clients/search?documentType=${docType}&documentNumber=${encodeURIComponent(
          trimmed,
        )}&clientType=${applicantType}`,
      );
      setSearchDone(true);
      if (result) {
        setIsExistingClient(true);
        setName(result.name);
        if (applicantType === "COMPANY" && result.economicActivity) {
          setEconomicActivity(result.economicActivity);
        }
      } else {
        setIsExistingClient(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al consultar el expediente.");
    } finally {
      setSearching(false);
    }
  }

  function handleNextStep1() {
    if (applicantType === "COMPANY" && !isCompanySupported) {
      setError(companyReason || "Tu institución no cuenta con productos crediticios activos para empresas.");
      return;
    }
    if (!documentNumber.trim()) {
      setError(
        applicantType === "COMPANY"
          ? "Introduce el NIT de la empresa."
          : "Introduce el documento de identidad.",
      );
      return;
    }
    if (!name.trim()) {
      setError(
        applicantType === "COMPANY"
          ? "Introduce la razón social de la empresa."
          : "Introduce el nombre completo del solicitante.",
      );
      return;
    }
    setError("");
    setStep(2);
  }

  function handleNextStep2() {
    if (requestedAmount === "" || Number(requestedAmount) < 100) {
      setError("El monto solicitado debe ser de al menos 100 Bs.");
      return;
    }
    setError("");
    setStep(3);
  }

  async function handleStartEvaluation() {
    if (!consentGiven) {
      setError(
        applicantType === "COMPANY"
          ? "Debes registrar la autorización formal de la empresa para iniciar la evaluación."
          : "Debes registrar el consentimiento informado del solicitante para iniciar la evaluación.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload: Omit<CreateEvaluationPayload, "idempotencyKey"> = {
        clientType: applicantType,
        documentType: applicantType === "COMPANY" ? "NIT" : "CI",
        documentNumber: documentNumber.trim(),
        name: name.trim(),
        economicActivity:
          applicantType === "COMPANY" && economicActivity.trim() ? economicActivity.trim() : undefined,
        purpose,
        requestedAmount: Number(requestedAmount),
        consentGiven: true,
      };

      const idempotencyKey = await evaluationOperationKey(slug, payload);
      const result = await institutionApi<EvaluationItem>(
        `/tenants/${encodeURIComponent(slug)}/evaluations`,
        { body: { ...payload, idempotencyKey } },
      );
      clearEvaluationOperationKey(slug, idempotencyKey);
      setCreatedEvaluation(result);
    } catch (err) {
      if (err instanceof InstitutionError) {
        setError(err.message);
      } else {
        setError("No se pudo iniciar la evaluación. Intenta nuevamente.");
      }
    } finally {
      setBusy(false);
    }
  }

  function resetForm() {
    setStep(1);
    setApplicantType("PERSON");
    setDocumentNumber("");
    setName("");
    setEconomicActivity("");
    setIsExistingClient(false);
    setSearchDone(false);
    setRequestedAmount(10000);
    setPurpose("WORKING_CAPITAL");
    setConsentGiven(false);
    setError("");
    setCreatedEvaluation(null);
  }

  if (!ready) {
    return (
      <main className="eval-container">
        <div className="eval-card">
          <div className="eval-client-badge" style={{ borderColor: "#fec84b", background: "#fef0c7" }}>
            <AlertCircle size={24} color="#b54708" />
            <div>
              <h3 style={{ color: "#b54708" }}>Institución pendiente de preparación</h3>
              <p style={{ color: "#712f06" }}>
                {tenantName} debe completar su preparación institucional (fuente financiera y productos
                activos) antes de poder iniciar evaluaciones.
              </p>
            </div>
          </div>
          <div className="eval-actions" style={{ borderTop: "none", marginTop: 24 }}>
            <Link className="eval-btn-secondary" to={`/${slug}`}>
              <ArrowLeft size={16} /> Volver al inicio
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (createdEvaluation) {
    return (
      <main className="eval-container">
        <div className="eval-card eval-success-card">
          <div className="eval-success-icon">
            <CheckCircle2 size={36} />
          </div>
          <span className="eval-success-badge">CASO CREADO EN BORRADOR</span>
          <h2>Evaluación preparada exitosamente</h2>
          <p>
            El caso para <strong>{createdEvaluation.clientName || name}</strong> (
            {applicantType === "COMPANY" ? "NIT: " : "CI: "}
            {createdEvaluation.documentNumber || documentNumber}) por un monto de{" "}
            <strong>
              Bs {Number(createdEvaluation.requestedAmount ?? requestedAmount).toLocaleString()}
            </strong>{" "}
            ha sido registrado con su snapshot inmutable y consentimiento legal.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            <Link className="eval-btn-primary" to={`/${slug}/evaluaciones/${createdEvaluation.id}`}>
              <TrendingUp size={18} /> Procesar evaluación ahora
            </Link>
            <Link className="eval-btn-secondary" to={`/${slug}/evaluaciones`}>
              <FileText size={18} /> Ver evaluaciones
            </Link>
            <button className="eval-btn-secondary" onClick={resetForm}>
              <Plus size={18} /> Preparar otra
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="eval-container">
      <div className="eval-header">
        <p className="eval-eyebrow">EVALUACIÓN CREDITICIA</p>
        <h1>Nueva evaluación para {tenantName}</h1>
        <p>Prepara la solicitud identificando el solicitante y su necesidad crediticia.</p>
      </div>

      <nav className="eval-stepper" aria-label="Pasos de la evaluación">
        <div className={`eval-step ${step === 1 ? "active" : step > 1 ? "completed" : ""}`}>
          <div className="eval-step-number">{step > 1 ? <Check size={16} /> : "1"}</div>
          <span className="eval-step-label">Solicitante</span>
        </div>
        <div className="eval-step-line" />
        <div className={`eval-step ${step === 2 ? "active" : step > 2 ? "completed" : ""}`}>
          <div className="eval-step-number">{step > 2 ? <Check size={16} /> : "2"}</div>
          <span className="eval-step-label">Solicitud</span>
        </div>
        <div className="eval-step-line" />
        <div className={`eval-step ${step === 3 ? "active" : ""}`}>
          <div className="eval-step-number">3</div>
          <span className="eval-step-label">Revisar e Iniciar</span>
        </div>
      </nav>

      <div className="eval-card">
        {error && (
          <div className="eval-error-text" role="alert" style={{ marginBottom: 16 }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* PASO 1: Solicitante */}
        {step === 1 && (
          <div>
            <h2>Paso 1: Identificación del solicitante</h2>
            <p className="eval-card-subtitle">
              Selecciona el tipo de solicitante e ingresa su documento para verificar si cuenta con expediente
              en {tenantName}.
            </p>

            {/* Selector Persona / Empresa (CA-14.01, CA-14.12) */}
            <div className="eval-type-selector" role="radiogroup" aria-label="Tipo de solicitante">
              <button
                type="button"
                className={`eval-type-card ${applicantType === "PERSON" ? "active" : ""}`}
                onClick={() => handleSelectApplicantType("PERSON")}
              >
                <div className="eval-type-title">
                  <User size={18} />
                  <strong>Persona</strong>
                </div>
                <span className="eval-type-desc">Persona natural con Cédula de Identidad (CI)</span>
              </button>

              <button
                type="button"
                className={`eval-type-card ${applicantType === "COMPANY" ? "active" : ""} ${
                  !isCompanySupported ? "disabled" : ""
                }`}
                onClick={() => handleSelectApplicantType("COMPANY")}
              >
                <div className="eval-type-title">
                  <Building2 size={18} />
                  <strong>Empresa</strong>
                  {!isCompanySupported && <span className="eval-tag-warning">No disponible</span>}
                </div>
                <span className="eval-type-desc">Persona jurídica o empresa comercial con NIT</span>
              </button>
            </div>

            {/* Alerta de restricción empresarial si no está soportado (PA-14.04) */}
            {applicantType === "COMPANY" && !isCompanySupported && (
              <div className="eval-restriction-alert" role="alert">
                <AlertCircle size={20} />
                <div>
                  <h4>Evaluación empresarial no disponible</h4>
                  <p>
                    {companyReason ||
                      "Tu institución no cuenta con productos crediticios activos para empresas. Configura al menos un producto empresarial en la sección de Productos."}
                  </p>
                </div>
              </div>
            )}

            {/* Formulario de documento e identificación (solo si está habilitado) */}
            {(applicantType === "PERSON" || isCompanySupported) && (
              <>
                <div className="eval-form-group">
                  <label htmlFor="eval-doc">
                    {applicantType === "COMPANY"
                      ? "Número de Identificación Tributaria (NIT)"
                      : "Documento de identidad (CI)"}
                  </label>
                  <div style={{ display: "flex", gap: 10 }}>
                    <input
                      id="eval-doc"
                      className="eval-input"
                      type="text"
                      placeholder={applicantType === "COMPANY" ? "Ej. 1020304050" : "Ej. 4892019"}
                      value={documentNumber}
                      onChange={(e) => {
                        setDocumentNumber(e.target.value);
                        setSearchDone(false);
                        // CA-14.08: Changing document number resets consent
                        setConsentGiven(false);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleSearch();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="eval-btn-secondary"
                      onClick={handleSearch}
                      disabled={searching || !documentNumber.trim()}
                    >
                      <Search size={16} /> {searching ? "Buscando..." : "Buscar"}
                    </button>
                  </div>
                  <p className="eval-help-text">Presiona Buscar o Enter para verificar el expediente.</p>
                </div>

                {searchDone && isExistingClient && (
                  <div className="eval-client-badge">
                    <UserCheck size={22} />
                    <div>
                      <h3>
                        {applicantType === "COMPANY"
                          ? "Expediente empresarial existente encontrado"
                          : "Expediente existente encontrado"}
                      </h3>
                      <p>
                        {applicantType === "COMPANY" ? (
                          <>
                            La empresa <strong>{name}</strong> (NIT: {documentNumber}) ya cuenta con historial
                            en esta institución. Los datos se reutilizarán en este caso.
                          </>
                        ) : (
                          <>
                            El cliente <strong>{name}</strong> ya cuenta con historial en esta institución.
                            Los datos del expediente se reutilizarán en este caso.
                          </>
                        )}
                      </p>
                    </div>
                  </div>
                )}

                {searchDone && !isExistingClient && (
                  <>
                    <div className="eval-form-group" style={{ marginTop: 20 }}>
                      <label htmlFor="eval-name">
                        {applicantType === "COMPANY"
                          ? "Razón social de la empresa"
                          : "Nombre completo del solicitante"}
                      </label>
                      <input
                        id="eval-name"
                        className="eval-input"
                        type="text"
                        placeholder={
                          applicantType === "COMPANY"
                            ? "Ej. Soluciones Industriales S.A."
                            : "Ej. Carlos Quispe Mamani"
                        }
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                      <p className="eval-help-text">
                        {applicantType === "COMPANY"
                          ? `Nueva empresa en ${tenantName}. Capturamos los datos mínimos para este caso.`
                          : `Nuevo solicitante en ${tenantName}. Capturamos los datos mínimos para este caso.`}
                      </p>
                    </div>

                    {applicantType === "COMPANY" && (
                      <div className="eval-form-group">
                        <label htmlFor="eval-economic-activity">Actividad económica (opcional)</label>
                        <input
                          id="eval-economic-activity"
                          className="eval-input"
                          type="text"
                          placeholder="Ej. Fabricación, Servicios de Software, Comercio..."
                          value={economicActivity}
                          onChange={(e) => setEconomicActivity(e.target.value)}
                        />
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            <div className="eval-actions">
              <Link className="eval-btn-secondary" to={`/${slug}`}>
                <ArrowLeft size={16} /> Cancelar
              </Link>
              <button
                type="button"
                className="eval-btn-primary"
                onClick={handleNextStep1}
                disabled={
                  (applicantType === "COMPANY" && !isCompanySupported) ||
                  !documentNumber.trim() ||
                  !name.trim()
                }
              >
                Continuar a Solicitud <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* PASO 2: Solicitud Crediticia */}
        {step === 2 && (
          <div>
            <h2>Paso 2: Solicitud crediticia</h2>
            <p className="eval-card-subtitle">
              Indica la necesidad del crédito y el monto que requiere el solicitante.
            </p>

            <div className="eval-form-group">
              <label htmlFor="eval-purpose">Finalidad / Necesidad crediticia</label>
              <select
                id="eval-purpose"
                className="eval-select"
                value={purpose}
                onChange={(e) => setPurpose(e.target.value as CreateEvaluationPayload["purpose"])}
              >
                <option value="WORKING_CAPITAL">Capital de trabajo</option>
                <option value="BUSINESS_INVESTMENT">Inversión empresarial</option>
                <option value="GREEN_PROJECT">Proyecto verde / sostenible</option>
                <option value="EQUIPMENT">Maquinaria y equipamiento</option>
                <option value="OTHER">Otra finalidad</option>
              </select>
            </div>

            <div className="eval-form-group">
              <label htmlFor="eval-amount">Monto solicitado (Bs)</label>
              <input
                id="eval-amount"
                className="eval-input"
                type="number"
                min="100"
                step="500"
                placeholder="10000"
                value={requestedAmount}
                onChange={(e) => setRequestedAmount(e.target.value === "" ? "" : Number(e.target.value))}
              />
              <p className="eval-help-text">Ingresa el monto requerido para evaluar compatibilidad.</p>
            </div>

            <div className="eval-actions">
              <button type="button" className="eval-btn-secondary" onClick={() => setStep(1)}>
                <ArrowLeft size={16} /> Volver a Solicitante
              </button>
              <button type="button" className="eval-btn-primary" onClick={handleNextStep2}>
                Revisar e Iniciar <ArrowRight size={16} />
              </button>
            </div>
          </div>
        )}

        {/* PASO 3: Revisar e Iniciar */}
        {step === 3 && (
          <div>
            <h2>Paso 3: Revisar e iniciar evaluación</h2>
            <p className="eval-card-subtitle">
              Verifica los datos de la solicitud y registra el consentimiento informado antes de procesar el
              caso.
            </p>

            <div className="eval-review-grid">
              <div className="eval-review-box">
                <div className="eval-review-box-header">
                  <h3>Solicitante</h3>
                  <button type="button" className="eval-btn-link" onClick={() => setStep(1)}>
                    Modificar
                  </button>
                </div>
                <div className="eval-review-row">
                  <span>Tipo:</span>
                  <strong>{applicantType === "COMPANY" ? "Empresa" : "Persona"}</strong>
                </div>
                <div className="eval-review-row">
                  <span>{applicantType === "COMPANY" ? "Razón social:" : "Nombre:"}</span>
                  <strong>{name}</strong>
                </div>
                <div className="eval-review-row">
                  <span>{applicantType === "COMPANY" ? "NIT:" : "Documento (CI):"}</span>
                  <strong>{documentNumber}</strong>
                </div>
                {applicantType === "COMPANY" && economicActivity && (
                  <div className="eval-review-row">
                    <span>Actividad económica:</span>
                    <strong>{economicActivity}</strong>
                  </div>
                )}
                <div className="eval-review-row">
                  <span>Expediente:</span>
                  <strong>{isExistingClient ? "Existente" : "Nuevo"}</strong>
                </div>
              </div>

              <div className="eval-review-box">
                <div className="eval-review-box-header">
                  <h3>Condiciones</h3>
                  <button type="button" className="eval-btn-link" onClick={() => setStep(2)}>
                    Modificar
                  </button>
                </div>
                <div className="eval-review-row">
                  <span>Finalidad:</span>
                  <strong>{PURPOSE_LABELS[purpose]}</strong>
                </div>
                <div className="eval-review-row">
                  <span>Monto solicitado:</span>
                  <strong>Bs {Number(requestedAmount).toLocaleString()}</strong>
                </div>
              </div>
            </div>
            <IntegrationNotice slug={slug} />
            <div className="eval-consent-box">
              <label className="eval-consent-label">
                <input
                  type="checkbox"
                  checked={consentGiven}
                  onChange={(e) => setConsentGiven(e.target.checked)}
                />
                <div className="eval-consent-text">
                  <h4>
                    {applicantType === "COMPANY"
                      ? "Autorización institucional de la empresa (Consentimiento legal)"
                      : "Autorización del solicitante (Consentimiento legal)"}
                  </h4>
                  <p>
                    {applicantType === "COMPANY"
                      ? `Confirmo que la empresa solicitante ha otorgado su autorización formal para la consulta de su información financiera institucional y la generación de recomendaciones crediticias dentro de ${tenantName}.`
                      : `Confirmo que el solicitante ha otorgado su autorización formal para la consulta de su información financiera simulada y la generación de recomendaciones crediticias dentro de ${tenantName}.`}
                  </p>
                </div>
              </label>
            </div>

            <div className="eval-actions">
              <button type="button" className="eval-btn-secondary" onClick={() => setStep(2)}>
                <ArrowLeft size={16} /> Volver a Solicitud
              </button>
              <button
                type="button"
                className="eval-btn-primary"
                onClick={handleStartEvaluation}
                disabled={busy || !consentGiven}
              >
                <ShieldCheck size={18} />
                {busy ? "Iniciando evaluación..." : "Iniciar evaluación"}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
