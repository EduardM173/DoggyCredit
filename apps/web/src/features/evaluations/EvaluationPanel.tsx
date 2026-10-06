import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileSearch,
  Info,
  Pencil,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { institutionApi, InstitutionError, type InstitutionHome } from "../institution/api";
import "./evaluation.css";

type Applicant = { id?: string; name: string; documentType: string; documentNumber: string };
type Prepared = {
  id: string;
  status: string;
  purpose: string;
  requestedAmount: string;
  consentGivenAt: string;
  applicantSnapshot: Applicant;
  createdAt: string;
};
const purposes = [
  {
    value: "WORKING_CAPITAL",
    label: "Capital de trabajo",
    detail: "Recursos para la operación de un negocio.",
  },
  { value: "GREEN_PROJECT", label: "Proyecto verde", detail: "Financiamiento para un proyecto sostenible." },
  {
    value: "BUSINESS_INVESTMENT",
    label: "Inversión empresarial",
    detail: "Inversión para desarrollar un negocio.",
  },
  { value: "EQUIPMENT", label: "Equipamiento", detail: "Compra de equipos para una actividad." },
  { value: "OTHER", label: "Otra finalidad", detail: "Otra necesidad crediticia del solicitante." },
];
const money = (value: string) =>
  new Intl.NumberFormat("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    Number(value),
  );
const validName = (value: string) =>
  Boolean(value.trim()) && value.length <= 90 && /^[\p{L}\p{M} '\u2019-]+$/u.test(value);
function validDate(value: string) {
  const date = new Date(value);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    date <= new Date() &&
    date.getUTCFullYear() > 0
  );
}
export function EvaluationPanel({ home }: { home: InstitutionHome }) {
  const { evaluationId } = useParams();
  const navigate = useNavigate();
  const base = "/" + home.tenant.slug;
  const api = "/tenants/" + home.tenant.slug + "/evaluations";
  const [ready, setReady] = useState<boolean | null>(null);
  const [reload, setReload] = useState(0);
  const [step, setStep] = useState<"document" | "person" | "need" | "review">("document");
  const [editing, setEditing] = useState(false);
  const [documentType, setDocumentType] = useState("CI");
  const [documentNumber, setDocumentNumber] = useState("");
  const [lookup, setLookup] = useState<"initial" | "found" | "missing">("initial");
  const [applicant, setApplicant] = useState<Applicant | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [phone, setPhone] = useState("");
  const [purpose, setPurpose] = useState("");
  const [amount, setAmount] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const key = useRef(crypto.randomUUID());
  async function failure(reason: unknown, message: string) {
    if (reason instanceof InstitutionError && reason.status === 401) {
      navigate("/iniciar-sesion", { replace: true });
      return;
    }
    if (reason instanceof InstitutionError && reason.status === 409) {
      try {
        const entry = await institutionApi<{ ready: boolean }>(api + "/preparation");
        if (!entry.ready) {
          setReady(false);
          setError("");
          return;
        }
      } catch {
        /* Keep the original operation recoverable. */
      }
    }
    setError(reason instanceof InstitutionError && reason.status === 403 ? reason.message : message);
  }
  useEffect(() => {
    const controller = new AbortController();
    institutionApi<{ ready: boolean } | Prepared>(
      evaluationId ? api + "/" + evaluationId : api + "/preparation",
      { signal: controller.signal },
    )
      .then((value) => {
        if ("ready" in value) setReady(value.ready);
        else setPrepared(value);
        setError("");
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("No pudimos cargar la evaluación. Intenta nuevamente.");
      });
    return () => controller.abort();
  }, [api, evaluationId, reload]);
  function invalid(next: Record<string, string>) {
    setErrors(next);
    if (Object.keys(next).length) {
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return true;
    }
    return false;
  }
  function change() {
    key.current = crypto.randomUUID();
    setErrors({});
    setError("");
    setConsent(false);
  }
  function selectDocument() {
    setLookup("initial");
    setApplicant(null);
    setFirstName("");
    setLastName("");
    setBirthDate("");
    setPhone("");
    change();
  }
  async function search(event: React.FormEvent) {
    event.preventDefault();
    const number = documentNumber.trim().toUpperCase();
    if (
      invalid(
        !number ||
          number.length > 60 ||
          !/^[\p{L}\p{N} -]+$/u.test(number) ||
          (documentType === "CI" && !/^\d+(?:-[A-Z0-9]+)?$/.test(number))
          ? {
              document:
                "Ingresa un documento válido. Para CI usa números y, si corresponde, un complemento con guion.",
            }
          : {},
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      const result = await institutionApi<{ found: boolean; applicant: Applicant | null }>(api + "/lookup", {
        body: { documentType, documentNumber: number },
      });
      setDocumentNumber(number);
      setLookup(result.found ? "found" : "missing");
      setApplicant(result.applicant);
    } catch (reason) {
      await failure(reason, "No pudimos buscar el expediente. Revisa la conexión y vuelve a intentar.");
    } finally {
      setBusy(false);
    }
  }
  function nextPerson(event: React.FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!validName(firstName)) next.firstName = "Ingresa nombres válidos, sin números.";
    if (!validName(lastName)) next.lastName = "Ingresa apellidos válidos, sin números.";
    if (!validDate(birthDate)) next.birthDate = "La fecha de nacimiento debe ser una fecha real, no futura.";
    if (phone && (phone.length > 40 || !/^\+?[0-9 ()-]+$/.test(phone)))
      next.phone = "Revisa el teléfono ingresado.";
    if (invalid(next)) return;
    setApplicant({ name: firstName.trim() + " " + lastName.trim(), documentType, documentNumber });
    setStep(editing ? "review" : "need");
    setEditing(false);
  }
  function nextNeed(event: React.FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!purpose) next.purpose = "Selecciona la finalidad del crédito.";
    if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0)
      next.amount = "Ingresa un monto mayor a Bs 0, con hasta dos decimales.";
    if (invalid(next)) return;
    setStep("review");
    setEditing(false);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (
      busy ||
      !applicant ||
      invalid(consent ? {} : { consent: "Debes confirmar el consentimiento antes de iniciar." })
    )
      return;
    setBusy(true);
    setError("");
    try {
      const value = await institutionApi<Prepared>(api, {
        body: {
          documentType,
          documentNumber,
          ...(applicant.id
            ? { clientId: applicant.id }
            : {
                person: {
                  firstName: firstName.trim(),
                  lastName: lastName.trim(),
                  birthDate,
                  ...(phone ? { phone: phone.trim() } : {}),
                },
              }),
          purpose,
          requestedAmount: amount,
          consent: true,
          idempotencyKey: key.current,
        },
      });
      navigate(base + "/evaluaciones/" + value.id, { replace: true });
    } catch (reason) {
      await failure(
        reason,
        "No pudimos confirmar el caso. Tus datos se conservan; intenta nuevamente. Si el expediente cambió, vuelve a buscar el documento.",
      );
    } finally {
      setBusy(false);
    }
  }
  const fieldError = (field: string) =>
    errors[field] ? (
      <small className="evaluation-field-error" id={field + "-error"}>
        {errors[field]}
      </small>
    ) : null;
  const summary = purposes.find((item) => item.value === purpose);
  const breadcrumb = (
    <div className="institution-breadcrumb">
      <Link to={base}>Inicio</Link>
      <ArrowRight size={16} />
      <Link to={base + "/evaluaciones"}>Evaluaciones</Link>
      <ArrowRight size={16} />
      {evaluationId ? "Caso preparado" : "Nueva evaluación"}
    </div>
  );
  if (evaluationId)
    return (
      <main className="institution-dashboard evaluation-page">
        {breadcrumb}
        {prepared ? (
          <>
            <p className="institution-eyebrow">EVALUACIÓN</p>
            <h1>Evaluación preparada</h1>
            <section className="evaluation-result">
              <CheckCircle2 size={32} />
              <h2>{prepared.applicantSnapshot.name}</h2>
              <p>
                {prepared.applicantSnapshot.documentType} {prepared.applicantSnapshot.documentNumber}
              </p>
              <dl>
                <dt>Finalidad</dt>
                <dd>{purposes.find((item) => item.value === prepared.purpose)?.label}</dd>
                <dt>Monto solicitado</dt>
                <dd>Bs {money(prepared.requestedAmount)}</dd>
                <dt>Estado</dt>
                <dd>Preparada</dd>
                <dt>Consentimiento registrado</dt>
                <dd>{new Date(prepared.consentGivenAt).toLocaleString("es-BO")}</dd>
              </dl>
              <p>El caso está guardado. La consulta financiera y la recomendación aún no se han iniciado.</p>
              <Link className="institution-primary" to={base + "/evaluaciones/nueva"}>
                Nueva evaluación
                <ArrowRight size={18} />
              </Link>
            </section>
          </>
        ) : error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => setReload((v) => v + 1)}>Reintentar</button>
          </>
        ) : (
          <p role="status">Cargando el caso...</p>
        )}
      </main>
    );
  if (ready === null || !ready)
    return (
      <main className="institution-dashboard evaluation-page">
        {breadcrumb}
        <h1>Nueva evaluación</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => setReload((v) => v + 1)}>Reintentar</button>
          </>
        ) : ready === null ? (
          <p role="status">Comprobando disponibilidad...</p>
        ) : (
          <section className="evaluation-result">
            <Info size={30} />
            <h2>Tu institución todavía no está lista para evaluar</h2>
            <p>Contacta al administrador de {home.tenant.name} para completar la preparación.</p>
            <Link to={base}>Volver al inicio</Link>
          </section>
        )}
      </main>
    );
  return (
    <main className="institution-dashboard evaluation-page">
      {breadcrumb}
      <p className="institution-eyebrow">
        EVALUACIÓN · PASO {step === "document" || step === "person" ? 1 : step === "need" ? 2 : 3} DE 3
      </p>
      <h1>
        {step === "document"
          ? "Identifica al solicitante"
          : step === "person"
            ? "Datos mínimos del solicitante"
            : step === "need"
              ? "Necesidad crediticia y monto solicitado"
              : "Revisar y autorizar evaluación"}
      </h1>
      <p className="institution-lead">
        {step === "document"
          ? "Busca a la persona por su documento para reutilizar su expediente o crear uno nuevo."
          : step === "person"
            ? "Completa solo la información mínima para continuar con la evaluación."
            : step === "need"
              ? "Indica para qué necesita el crédito y cuánto desea solicitar."
              : "Verifica la información ingresada antes de iniciar la evaluación."}
      </p>
      <div className={"evaluation-grid" + (step === "person" ? " evaluation-wide" : "")}>
        <form
          ref={form}
          className="evaluation-form"
          noValidate
          onSubmit={
            step === "document"
              ? search
              : step === "person"
                ? nextPerson
                : step === "need"
                  ? nextNeed
                  : submit
          }
        >
          {error && (
            <p role="alert" className="institution-error">
              {error}
            </p>
          )}
          {Object.keys(errors).length > 0 && step !== "document" && step !== "review" && (
            <p role="alert" className="institution-error">
              Revisa los campos marcados para continuar.
            </p>
          )}
          {step === "document" ? (
            <>
              <h2>Documento del solicitante</h2>
              <div className="evaluation-document">
                <label>
                  Tipo de documento
                  <select
                    value={documentType}
                    disabled={busy}
                    onChange={(e) => {
                      setDocumentType(e.target.value);
                      selectDocument();
                    }}
                  >
                    <option value="CI">CI</option>
                    <option value="PASSPORT">Pasaporte</option>
                    <option value="OTHER">Otro documento</option>
                  </select>
                </label>
                <label>
                  Número de documento
                  <input
                    value={documentNumber}
                    maxLength={60}
                    disabled={busy}
                    aria-invalid={Boolean(errors.document)}
                    aria-describedby={errors.document ? "document-error" : undefined}
                    onChange={(e) => {
                      setDocumentNumber(e.target.value);
                      selectDocument();
                    }}
                    placeholder="Ingresa el número de documento"
                  />
                  {fieldError("document")}
                </label>
                <button className="institution-primary" disabled={busy}>
                  <Search size={20} />
                  {busy ? "Buscando..." : "Buscar solicitante"}
                </button>
              </div>
              <p className="evaluation-info">
                <Info size={18} />
                Usa el documento del solicitante para iniciar la evaluación.
              </p>
              <section className={"evaluation-lookup " + lookup} aria-live="polite">
                {lookup === "found" ? (
                  <>
                    <CheckCircle2 size={36} />
                    <h2>Expediente encontrado</h2>
                    <p>Reutilizaremos sus datos básicos para continuar.</p>
                    <strong>{applicant?.name}</strong>
                    <p>
                      {documentType} {documentNumber} · Solicitante existente
                    </p>
                    <div className="evaluation-actions">
                      <button
                        type="button"
                        className="institution-primary"
                        onClick={() => {
                          setErrors({});
                          setStep(editing ? "review" : "need");
                          setEditing(false);
                        }}
                      >
                        Continuar con este solicitante
                      </button>
                      <button type="button" onClick={selectDocument}>
                        Buscar otro documento
                      </button>
                    </div>
                  </>
                ) : lookup === "missing" ? (
                  <>
                    <FileSearch size={44} />
                    <h2>No encontramos un expediente en {home.tenant.name}</h2>
                    <p>Para continuar, completaremos solo los datos mínimos del solicitante.</p>
                    <div className="evaluation-actions">
                      <button
                        type="button"
                        className="institution-primary"
                        onClick={() => {
                          setErrors({});
                          setStep("person");
                        }}
                      >
                        Completar datos del solicitante
                      </button>
                      <button type="button" onClick={selectDocument}>
                        Buscar otro documento
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <FileSearch size={56} />
                    <h2>
                      {errors.document
                        ? "Corrige el documento para continuar."
                        : "Ingresa un documento para comenzar."}
                    </h2>
                    <p>Si existe un expediente lo reutilizaremos con sus datos básicos.</p>
                  </>
                )}
              </section>
            </>
          ) : step === "person" ? (
            <>
              <p className="evaluation-info">
                <Info size={22} />
                Solo pedimos los datos necesarios para crear el expediente y continuar.
              </p>
              <h2>Información del solicitante</h2>
              <div className="evaluation-applicant">
                <UserRound size={26} />
                <span>
                  {documentType} <strong>{documentNumber}</strong>
                </span>
                <span>Sin expediente previo</span>
              </div>
              <div className="evaluation-person-fields">
                <label>
                  Nombre(s) *
                  <input
                    aria-label="Nombre(s) *"
                    value={firstName}
                    maxLength={90}
                    aria-invalid={Boolean(errors.firstName)}
                    aria-describedby={errors.firstName ? "firstName-error" : undefined}
                    onChange={(e) => {
                      setFirstName(e.target.value);
                      change();
                    }}
                    autoComplete="off"
                  />
                  {fieldError("firstName")}
                </label>
                <label>
                  Apellido(s) *
                  <input
                    aria-label="Apellido(s) *"
                    value={lastName}
                    maxLength={90}
                    aria-invalid={Boolean(errors.lastName)}
                    aria-describedby={errors.lastName ? "lastName-error" : undefined}
                    onChange={(e) => {
                      setLastName(e.target.value);
                      change();
                    }}
                    autoComplete="off"
                  />
                  {fieldError("lastName")}
                </label>
                <label>
                  Fecha de nacimiento *
                  <input
                    aria-label="Fecha de nacimiento *"
                    type="date"
                    value={birthDate}
                    max={new Date().toISOString().slice(0, 10)}
                    aria-invalid={Boolean(errors.birthDate)}
                    aria-describedby={errors.birthDate ? "birthDate-error" : undefined}
                    onChange={(e) => {
                      setBirthDate(e.target.value);
                      change();
                    }}
                  />
                  {fieldError("birthDate")}
                </label>
                <label>
                  Teléfono (opcional)
                  <input
                    type="tel"
                    value={phone}
                    maxLength={40}
                    aria-invalid={Boolean(errors.phone)}
                    aria-describedby={errors.phone ? "phone-error" : undefined}
                    onChange={(e) => {
                      setPhone(e.target.value);
                      change();
                    }}
                  />
                  {fieldError("phone")}
                </label>
              </div>
              <div className="evaluation-actions">
                <button
                  type="button"
                  onClick={() => {
                    setErrors({});
                    setStep("document");
                  }}
                >
                  <ArrowLeft size={18} />
                  Volver a identificar solicitante
                </button>
                <button className="institution-primary">
                  Continuar a solicitud crediticia
                  <ArrowRight size={18} />
                </button>
              </div>
            </>
          ) : step === "need" ? (
            <>
              <div className="evaluation-applicant">
                <UserRound size={28} />
                <span>
                  <small>Solicitante</small>
                  <strong>
                    {applicant?.name} · {documentType} {documentNumber}
                  </strong>
                </span>
              </div>
              <h2>Detalle de la solicitud</h2>
              <label>
                Finalidad del crédito *
                <select
                  value={purpose}
                  aria-invalid={Boolean(errors.purpose)}
                  aria-describedby={errors.purpose ? "purpose-error" : undefined}
                  onChange={(e) => {
                    setPurpose(e.target.value);
                    change();
                  }}
                >
                  <option value="">Selecciona una finalidad</option>
                  {purposes.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
                {fieldError("purpose")}
              </label>
              {summary && <p className="evaluation-field-hint">{summary.detail}</p>}
              <label>
                Monto solicitado *
                <div className="evaluation-amount">
                  <input
                    aria-label="Monto solicitado *"
                    inputMode="decimal"
                    value={amount}
                    aria-invalid={Boolean(errors.amount)}
                    aria-describedby={errors.amount ? "amount-error" : "amount-hint"}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      change();
                    }}
                  />
                  <span aria-hidden="true">Bs</span>
                </div>
                {fieldError("amount")}
              </label>
              <p className="evaluation-field-hint" id="amount-hint">
                Ingresa el monto en bolivianos. Usa punto para los decimales, sin separadores de miles.
              </p>
              <div className="evaluation-actions">
                <button
                  type="button"
                  onClick={() => {
                    setErrors({});
                    setStep(applicant?.id ? "document" : "person");
                  }}
                >
                  <ArrowLeft size={18} />
                  Volver a datos del solicitante
                </button>
                <button className="institution-primary">
                  {editing ? "Guardar y volver al resumen" : "Revisar evaluación"}
                  <ArrowRight size={18} />
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>Resumen de la solicitud</h2>
              <div className="evaluation-review">
                {[
                  {
                    label: "Solicitante",
                    value: applicant?.name,
                    detail: documentType + " " + documentNumber,
                    action: "document",
                  },
                  {
                    label: "Finalidad del crédito",
                    value: summary?.label,
                    detail: summary?.detail,
                    action: "need",
                  },
                  {
                    label: "Monto solicitado",
                    value: "Bs " + money(amount),
                    detail: "Monto en bolivianos",
                    action: "need",
                  },
                ].map((item) => (
                  <div key={item.label}>
                    <span>
                      <small>{item.label}</small>
                      <strong>{item.value}</strong>
                      <p>{item.detail}</p>
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      aria-label={"Modificar " + item.label.toLowerCase()}
                      onClick={() => {
                        setErrors({});
                        setEditing(true);
                        setStep(item.action as "document" | "need");
                      }}
                    >
                      <Pencil size={18} />
                      Modificar
                    </button>
                  </div>
                ))}
              </div>
              <label className={"evaluation-consent" + (errors.consent ? " invalid" : "")}>
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={busy}
                  aria-invalid={Boolean(errors.consent)}
                  aria-describedby={errors.consent ? "consent-error" : undefined}
                  onChange={(e) => {
                    setConsent(e.target.checked);
                    setErrors({});
                  }}
                />
                <span>
                  <strong>Consentimiento del solicitante</strong>
                  <span>
                    Confirmo que el solicitante autorizó la consulta de su información financiera para esta
                    evaluación.
                  </span>
                  {fieldError("consent")}
                </span>
              </label>
              <div className="evaluation-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setErrors({});
                    setStep("need");
                  }}
                >
                  <ArrowLeft size={18} />
                  Volver
                </button>
                <button className="institution-primary" disabled={busy}>
                  {busy ? "Guardando evaluación..." : "Iniciar evaluación"}
                  <ArrowRight size={18} />
                </button>
              </div>
            </>
          )}
        </form>
        {step !== "person" && (
          <aside className="evaluation-aside">
            <section>
              <h2>
                {step === "document"
                  ? "¿Qué ocurre al buscar?"
                  : step === "need"
                    ? "¿Qué sigue después?"
                    : "¿Qué ocurrirá al iniciar?"}
              </h2>
              <ol>
                {(step === "document"
                  ? [
                      "Si el expediente existe, reutilizamos sus datos básicos.",
                      "Si no existe, podrás registrarlo en el siguiente paso.",
                      "Solo necesitas el documento para comenzar.",
                    ]
                  : [
                      "Obtendremos la información financiera.",
                      "Compararemos con los productos disponibles.",
                      "Verás el resultado de la evaluación.",
                    ]
                ).map((item, index) => (
                  <li key={item}>
                    <span>{index + 1}</span>
                    {item}
                  </li>
                ))}
              </ol>
            </section>
            <section>
              <ShieldCheck size={27} />
              <h2>Importante</h2>
              <p>La recomendación de DoggyCredit no constituye una aprobación formal del crédito.</p>
              <p>Puedes revisar y corregir los datos antes de iniciar.</p>
            </section>
          </aside>
        )}
      </div>
    </main>
  );
}
