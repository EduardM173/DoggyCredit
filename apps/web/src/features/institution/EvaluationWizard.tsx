import { useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileText,
  Plus,
  Search,
  ShieldCheck,
  UserCheck,
} from "lucide-react";
import {
  institutionApi,
  InstitutionError,
  type ClientSearchResult,
  type CreateEvaluationPayload,
  type EvaluationItem,
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
}: {
  slug: string;
  tenantName: string;
  ready: boolean;
}) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [documentNumber, setDocumentNumber] = useState("");
  const [name, setName] = useState("");
  const [isExistingClient, setIsExistingClient] = useState(false);
  const [searchDone, setSearchDone] = useState(false);
  const [searching, setSearching] = useState(false);

  const [purpose, setPurpose] = useState<
    "WORKING_CAPITAL" | "GREEN_PROJECT" | "BUSINESS_INVESTMENT" | "EQUIPMENT" | "OTHER"
  >("WORKING_CAPITAL");
  const [requestedAmount, setRequestedAmount] = useState<number | "">(10000);

  const [consentGiven, setConsentGiven] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [createdEvaluation, setCreatedEvaluation] = useState<EvaluationItem | null>(null);

  // Search client by CI in the tenant
  async function handleSearch() {
    const trimmed = documentNumber.trim();
    if (!trimmed || trimmed.length < 3) {
      setError("Introduce un número de documento válido de al menos 3 dígitos.");
      return;
    }
    setSearching(true);
    setError("");
    try {
      const result = await institutionApi<ClientSearchResult>(
        `/tenants/${encodeURIComponent(slug)}/evaluations/clients/search?documentType=CI&documentNumber=${encodeURIComponent(
          trimmed,
        )}`,
      );
      setSearchDone(true);
      if (result) {
        setIsExistingClient(true);
        setName(result.name);
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
    if (!documentNumber.trim()) {
      setError("Introduce el documento de identidad.");
      return;
    }
    if (!name.trim()) {
      setError("Introduce el nombre completo del solicitante.");
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
      setError("Debes registrar el consentimiento informado del solicitante para iniciar la evaluación.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload: CreateEvaluationPayload = {
        documentType: "CI",
        documentNumber: documentNumber.trim(),
        name: name.trim(),
        purpose,
        requestedAmount: Number(requestedAmount),
        consentGiven: true,
      };

      const result = await institutionApi<EvaluationItem>(
        `/tenants/${encodeURIComponent(slug)}/evaluations`,
        { body: payload },
      );
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
    setDocumentNumber("");
    setName("");
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
            El caso para <strong>{createdEvaluation.clientName || name}</strong> (CI:{" "}
            {createdEvaluation.documentNumber || documentNumber}) por un monto de{" "}
            <strong>Bs {Number(createdEvaluation.requestedAmount ?? requestedAmount).toLocaleString()}</strong> ha
            sido registrado con su snapshot inmutable y consentimiento legal.
          </p>
          <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
            <button className="eval-btn-primary" onClick={resetForm}>
              <Plus size={18} /> Nueva evaluación
            </button>
            <Link className="eval-btn-secondary" to={`/${slug}/evaluaciones`}>
              <FileText size={18} /> Ver evaluaciones
            </Link>
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
        <p>Prepara la solicitud identificando la persona y su necesidad crediticia.</p>
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
              Ingresa el documento de identidad para verificar si el solicitante ya cuenta con expediente en{" "}
              {tenantName}.
            </p>

            <div className="eval-form-group">
              <label htmlFor="eval-doc">Documento de identidad (CI)</label>
              <div style={{ display: "flex", gap: 10 }}>
                <input
                  id="eval-doc"
                  className="eval-input"
                  type="text"
                  placeholder="Ej. 4892019"
                  value={documentNumber}
                  onChange={(e) => {
                    setDocumentNumber(e.target.value);
                    setSearchDone(false);
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
                  <h3>Expediente existente encontrado</h3>
                  <p>
                    El cliente <strong>{name}</strong> ya cuenta con historial en esta institución. Los
                    datos del expediente se reutilizarán en este caso.
                  </p>
                </div>
              </div>
            )}

            {searchDone && !isExistingClient && (
              <div className="eval-form-group" style={{ marginTop: 20 }}>
                <label htmlFor="eval-name">Nombre completo del solicitante</label>
                <input
                  id="eval-name"
                  className="eval-input"
                  type="text"
                  placeholder="Ej. Carlos Quispe Mamani"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                <p className="eval-help-text">
                  Nuevo solicitante en {tenantName}. Capturamos los datos mínimos para este caso.
                </p>
              </div>
            )}

            <div className="eval-actions">
              <Link className="eval-btn-secondary" to={`/${slug}`}>
                <ArrowLeft size={16} /> Cancelar
              </Link>
              <button
                type="button"
                className="eval-btn-primary"
                onClick={handleNextStep1}
                disabled={!documentNumber.trim() || !name.trim()}
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
                onChange={(e) =>
                  setPurpose(e.target.value as CreateEvaluationPayload["purpose"])
                }
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
                onChange={(e) =>
                  setRequestedAmount(e.target.value === "" ? "" : Number(e.target.value))
                }
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
                  <span>Nombre:</span>
                  <strong>{name}</strong>
                </div>
                <div className="eval-review-row">
                  <span>Documento (CI):</span>
                  <strong>{documentNumber}</strong>
                </div>
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

            <div className="eval-consent-box">
              <label className="eval-consent-label">
                <input
                  type="checkbox"
                  checked={consentGiven}
                  onChange={(e) => setConsentGiven(e.target.checked)}
                />
                <div className="eval-consent-text">
                  <h4>Autorización del solicitante (Consentimiento legal)</h4>
                  <p>
                    Confirmo que el solicitante ha otorgado su autorización formal para la consulta de su
                    información financiera simulada y la generación de recomendaciones crediticias dentro de{" "}
                    {tenantName}.
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
