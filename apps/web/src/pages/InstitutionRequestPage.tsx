import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Check,
  CircleHelp,
  FileText,
  LoaderCircle,
  LockKeyhole,
  MoreHorizontal,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { NextSteps } from "../components/NextSteps";
import { PublicInfo } from "../components/PublicInfo";
import {
  submitInstitutionRequest,
  validateRequest,
  type InstitutionType,
  type RequestInput,
} from "../features/institution-requests/api";
import { fetchPublicPlans, type PublicPlan } from "../features/institution-requests/public-plans";

const institutionTypes: { value: InstitutionType; label: string; icon: typeof Building2 }[] = [
  { value: "BANK", label: "Banco", icon: Building2 },
  { value: "FINANCIAL_INSTITUTION", label: "Financiera", icon: FileText },
  { value: "COOPERATIVE", label: "Cooperativa", icon: Users },
  { value: "OTHER", label: "Otra", icon: MoreHorizontal },
];

function Field({
  label,
  error,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  return (
    <div className="field">
      <label htmlFor={props.id}>
        {label} <span className="required">*</span>
      </label>
      <input
        {...props}
        required
        aria-invalid={!!error}
        aria-describedby={error ? `${props.id}-error` : hint ? `${props.id}-hint` : undefined}
      />
      {error ? (
        <p className="field-error" id={`${props.id}-error`}>
          {error}
        </p>
      ) : (
        hint && (
          <p className="field-hint" id={`${props.id}-hint`}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export function InstitutionRequestPage() {
  const [params] = useSearchParams();
  const [publicPlans, setPublicPlans] = useState<PublicPlan[]>([]);
  const [plansError, setPlansError] = useState(false);
  const navigate = useNavigate();
  const form = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);
  const alert = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<RequestInput>(() => ({
    institutionName: "",
    taxId: "",
    institutionType: "",
    planInterest: "UNSURE",
    contactName: "",
    contactRole: "",
    contactEmail: "",
    contactPhone: "",
    representsInstitution: false,
    acceptsTerms: false,
  }));
  const [countryCode, setCountryCode] = useState("+591");
  const [errors, setErrors] = useState<Partial<Record<keyof RequestInput, string>>>({});
  const [serverError, setServerError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetchPublicPlans(controller.signal)
      .then((available) => {
        setPublicPlans(available);
        const requested = params.get("plan");
        if (requested && available.some((plan) => plan.code === requested))
          setValues((current) =>
            current.planInterest === "UNSURE" ? { ...current, planInterest: requested } : current,
          );
      })
      .catch(() => {
        if (!controller.signal.aborted) setPlansError(true);
      });
    return () => controller.abort();
  }, [params]);
  function update<K extends keyof RequestInput>(key: K, value: RequestInput[K]) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setServerError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const input = { ...values, contactPhone: `${countryCode}${values.contactPhone}` };
    const validation = validateRequest(input);
    setErrors(validation);
    setServerError("");
    if (Object.keys(validation).length) {
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    try {
      const receipt = await submitInstitutionRequest(input);
      navigate("/solicitud-recibida", { state: { receipt }, replace: true });
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "No pudimos enviar la solicitud.");
      requestAnimationFrame(() => alert.current?.focus());
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }
  return (
    <main className="request-page" id="main-content">
      <div className="container">
        <div className="request-intro">
          <p className="eyebrow">Solicitar acceso</p>
          <h1>
            Solicita acceso a <span>DoggyCredit</span>
          </h1>
          <p>
            Cuéntanos sobre tu institución. Revisaremos tu solicitud y te guiaremos
            <br className="desktop-break" /> en los siguientes pasos.
          </p>
        </div>
        <div className="request-grid">
          <form
            ref={form}
            className="request-form"
            noValidate
            onSubmit={submit}
            aria-label="Solicitud de acceso"
            aria-busy={submitting}
          >
            <fieldset disabled={submitting} className="form-section">
              <legend className="sr-only">Datos de la institución</legend>
              <div className="form-heading">
                <span className="feature-icon">
                  <Building2 size={26} />
                </span>
                <div>
                  <h2>Datos de la institución</h2>
                  <p>Información básica de tu institución y el plan de interés.</p>
                </div>
              </div>
              <div className="institution-fields">
                <Field
                  id="institutionName"
                  name="institutionName"
                  label="Nombre o razón social"
                  placeholder="Ej. Banco del Sol S.A."
                  autoComplete="organization"
                  maxLength={180}
                  value={values.institutionName}
                  onChange={(e) => update("institutionName", e.target.value)}
                  error={errors.institutionName}
                />
                <Field
                  id="taxId"
                  name="taxId"
                  label="NIT"
                  placeholder="Ej. 1234567890"
                  inputMode="numeric"
                  maxLength={60}
                  value={values.taxId}
                  onChange={(e) => update("taxId", e.target.value)}
                  error={errors.taxId}
                  hint="Ingresa el NIT sin guiones."
                />
                <fieldset className="institution-selector">
                  <legend>
                    Tipo de institución <span className="required">*</span>
                  </legend>
                  <div className="type-options">
                    {institutionTypes.map(({ value, label, icon: Icon }, index) => (
                      <label
                        className={`type-option${values.institutionType === value ? " selected" : ""}`}
                        key={value}
                      >
                        <input
                          type="radio"
                          name="institutionType"
                          value={value}
                          checked={values.institutionType === value}
                          onChange={() => update("institutionType", value)}
                          required
                          aria-invalid={index === 0 && !!errors.institutionType}
                          aria-describedby={errors.institutionType ? "institutionType-error" : undefined}
                        />
                        <Icon size={25} />
                        <span>{label}</span>
                        {values.institutionType === value && <Check className="selection-check" size={17} />}
                      </label>
                    ))}
                  </div>
                  {errors.institutionType && (
                    <p className="field-error" id="institutionType-error">
                      {errors.institutionType}
                    </p>
                  )}
                </fieldset>
                <div className="field">
                  <label htmlFor="planInterest">
                    Plan de interés <span className="required">*</span>
                  </label>
                  <select
                    id="planInterest"
                    name="planInterest"
                    value={values.planInterest}
                    onChange={(e) => update("planInterest", e.target.value as RequestInput["planInterest"])}
                    aria-invalid={!!errors.planInterest}
                    aria-describedby="planInterest-hint"
                    required
                  >
                    <option value="UNSURE">Aún no estoy seguro</option>
                    {publicPlans.map((plan) => (
                      <option key={plan.code} value={plan.code}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                  <p className={errors.planInterest ? "field-error" : "field-hint"} id="planInterest-hint">
                    {errors.planInterest ||
                      (plansError
                        ? "No pudimos cargar los planes; puedes continuar sin elegir uno."
                        : 'Si todavía no tienes un plan definido, puedes seleccionar "Aún no estoy seguro".')}
                  </p>
                </div>
              </div>
            </fieldset>
            <fieldset disabled={submitting} className="form-section responsible-section">
              <legend className="sr-only">Persona responsable</legend>
              <div className="form-heading">
                <span className="feature-icon">
                  <UserRound size={26} />
                </span>
                <div>
                  <h2>Persona responsable</h2>
                  <p>Datos de la persona de contacto de tu institución.</p>
                </div>
              </div>
              <div className="contact-fields">
                <Field
                  id="contactName"
                  name="contactName"
                  label="Nombre completo"
                  placeholder="Ej. Ana María López"
                  autoComplete="name"
                  maxLength={140}
                  value={values.contactName}
                  onChange={(e) => update("contactName", e.target.value)}
                  error={errors.contactName}
                />
                <Field
                  id="contactRole"
                  name="contactRole"
                  label="Cargo"
                  placeholder="Ej. Gerente de Innovación"
                  autoComplete="organization-title"
                  maxLength={120}
                  value={values.contactRole}
                  onChange={(e) => update("contactRole", e.target.value)}
                  error={errors.contactRole}
                />
                <Field
                  id="contactEmail"
                  name="contactEmail"
                  label="Correo corporativo"
                  type="email"
                  placeholder="Ej. ana.lopez@bancodelsol.com"
                  autoComplete="email"
                  maxLength={254}
                  value={values.contactEmail}
                  onChange={(e) => update("contactEmail", e.target.value)}
                  error={errors.contactEmail}
                  hint="Usaremos este correo para verificar la solicitud."
                />
                <div className="field">
                  <label htmlFor="contactPhone">
                    Teléfono <span className="required">*</span>
                  </label>
                  <div className="phone-input">
                    <select
                      aria-label="Código de país"
                      value={countryCode}
                      onChange={(e) => setCountryCode(e.target.value)}
                    >
                      {[
                        ["+591", "BO"],
                        ["+51", "PE"],
                        ["+54", "AR"],
                        ["+56", "CL"],
                        ["+57", "CO"],
                      ].map(([code, country]) => (
                        <option key={code} value={code}>
                          {country} {code}
                        </option>
                      ))}
                    </select>
                    <input
                      id="contactPhone"
                      name="contactPhone"
                      type="tel"
                      autoComplete="tel-national"
                      placeholder="Ej. 71234567"
                      maxLength={24}
                      value={values.contactPhone}
                      onChange={(e) => update("contactPhone", e.target.value)}
                      required
                      aria-invalid={!!errors.contactPhone}
                      aria-describedby={errors.contactPhone ? "contactPhone-error" : undefined}
                    />
                  </div>
                  {errors.contactPhone && (
                    <p className="field-error" id="contactPhone-error">
                      {errors.contactPhone}
                    </p>
                  )}
                </div>
              </div>
            </fieldset>
            <fieldset disabled={submitting} className="consents">
              <legend className="sr-only">Confirmaciones</legend>
              <div>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={values.representsInstitution}
                    onChange={(e) => update("representsInstitution", e.target.checked)}
                    required
                    aria-invalid={!!errors.representsInstitution}
                    aria-describedby={
                      errors.representsInstitution ? "representsInstitution-error" : undefined
                    }
                  />
                  <span>
                    Confirmo que represento a la institución indicada. <span className="required">*</span>
                  </span>
                </label>
                {errors.representsInstitution && (
                  <p className="field-error" id="representsInstitution-error">
                    {errors.representsInstitution}
                  </p>
                )}
              </div>
              <div>
                <div className="checkbox-row">
                  <input
                    id="acceptsTerms"
                    type="checkbox"
                    checked={values.acceptsTerms}
                    onChange={(e) => update("acceptsTerms", e.target.checked)}
                    required
                    aria-invalid={!!errors.acceptsTerms}
                    aria-describedby={errors.acceptsTerms ? "acceptsTerms-error" : undefined}
                  />
                  <span>
                    <label htmlFor="acceptsTerms">
                      Acepto los términos de uso y la política de privacidad de DoggyCredit.{" "}
                      <span className="required">*</span>
                    </label>
                    <span className="consent-links">
                      <PublicInfo kind="terms">Términos de uso</PublicInfo>
                      <PublicInfo kind="privacy">Política de privacidad</PublicInfo>
                    </span>
                  </span>
                </div>
                {errors.acceptsTerms && (
                  <p className="field-error" id="acceptsTerms-error">
                    {errors.acceptsTerms}
                  </p>
                )}
              </div>
            </fieldset>
            {serverError && (
              <div className="error-banner" role="alert" tabIndex={-1} ref={alert}>
                <AlertCircle size={20} />
                <span>{serverError}</span>
              </div>
            )}
            <button type="submit" className="button button-primary submit-button" disabled={submitting}>
              {submitting ? (
                <>
                  <LoaderCircle size={20} className="spinner" />
                  Enviando solicitud…
                </>
              ) : (
                <>
                  Enviar solicitud <ArrowRight size={20} />
                </>
              )}
            </button>
            <p className="secure-note">
              <LockKeyhole size={14} />
              Después de enviar la solicitud te pediremos verificar tu correo.
            </p>
          </form>
          <aside className="request-aside">
            <NextSteps />
            <section className="trust-section">
              <div className="form-heading">
                <span className="feature-icon">
                  <ShieldCheck size={29} />
                </span>
                <div>
                  <h2>Tu información está segura</h2>
                  <p>Usamos tus datos únicamente para gestionar la solicitud de acceso a DoggyCredit.</p>
                </div>
              </div>
              <ul className="trust-list">
                {[
                  "Tratamos tu información con confidencialidad.",
                  "No compartimos tus datos con terceros no autorizados.",
                  "Aplicamos buenas prácticas de seguridad en el manejo de la información.",
                  "Nos comunicaremos a través de tu correo corporativo.",
                ].map((text) => (
                  <li key={text}>
                    <Check size={17} />
                    {text}
                  </li>
                ))}
              </ul>
            </section>
            <div className="contact-help">
              <CircleHelp size={25} />
              <div>
                <h3>¿Tienes preguntas?</h3>
                <p>Conversemos sobre tu institución.</p>
              </div>
              <PublicInfo kind="contact" className="button button-outline">
                Contactar <ArrowRight size={15} />
              </PublicInfo>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
