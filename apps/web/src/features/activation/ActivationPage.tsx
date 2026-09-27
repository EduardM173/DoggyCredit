import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowRight, Building2, Check, Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { Brand } from "../../components/Brand";
import "./activation.css";

type Preview = {
  valid: true;
  institution: { name: string };
  invitedUser: { name: string; email: string };
  requiresCredentialSetup: boolean;
  expiresAt: string;
};
async function activationApi<T>(
  operation: "preview" | "activate",
  body: object,
  signal?: AbortSignal,
): Promise<T> {
  const base = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
  const response = await fetch(`${base}/membership-invitations/${operation}`, {
    method: "POST",
    cache: "no-store",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error("Demasiados intentos. Espera antes de volver a intentar.");
    const data = await response.json().catch(() => ({}));
    const message = typeof data.message === "string" ? data.message : "No pudimos validar el enlace.";
    throw new Error(message);
  }
  return response.json();
}

export function ActivationPage() {
  const [token, setToken] = useState<string | null>(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1)).get("token");
    const query = new URLSearchParams(window.location.search).get("token");
    window.history.replaceState(window.history.state, "", window.location.pathname);
    return hash || query;
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState(token ? "" : "El enlace de activación no es válido.");
  const [loading, setLoading] = useState(!!token);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const [visible, setVisible] = useState(false);
  const [confirmVisible, setConfirmVisible] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [success, setSuccess] = useState(false);
  const passwordLength = Array.from(password.normalize("NFC")).length;
  const lengthValid = passwordLength >= 15 && passwordLength <= 128;
  const confirmationMatches =
    confirmation.length > 0 && password.normalize("NFC") === confirmation.normalize("NFC");
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    activationApi<Preview>("preview", { token }, controller.signal)
      .then(setPreview)
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token]);
  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !preview || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError("");
    try {
      if (preview.requiresCredentialSetup && !lengthValid)
        throw new Error("La contraseña debe tener entre 15 y 128 caracteres.");
      if (preview.requiresCredentialSetup && !confirmationMatches)
        throw new Error("Las contraseñas no coinciden.");
      await activationApi("activate", preview.requiresCredentialSetup ? { token, password } : { token });
      setPassword("");
      setConfirmation("");
      setToken(null);
      setSuccess(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo activar la cuenta.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }
  return (
    <div className="activation-page">
      <header className="activation-header">
        <Brand dark />
        <Link to="/" aria-label="Volver al inicio" title="Volver al inicio">
          <ArrowLeft size={18} />
          <span>Volver al inicio</span>
        </Link>
      </header>
      <main className="activation-main">
        <section className="activation-intro">
          <p className="activation-eyebrow">ACTIVACIÓN DE CUENTA</p>
          <h1>
            Tu espacio institucional está listo <span>DoggyCredit</span>
          </h1>
          <p>
            {success
              ? `Tu acceso como administrador de ${preview?.institution.name} está activo.`
              : preview
                ? `${preview.institution.name} ya tiene su espacio habilitado. Activa tu acceso como administrador inicial.`
                : "Acceso institucional seguro para tu organización."}
          </p>
          {preview && (
            <>
              <div className="activation-institution">
                <Building2 size={32} />
                <div>
                  <strong>{preview.institution.name}</strong>
                  <small>Administrador inicial</small>
                </div>
              </div>
              <dl className="activation-contact">
                <div>
                  <dt>NOMBRE</dt>
                  <dd>{preview.invitedUser.name}</dd>
                </div>
                <div>
                  <dt>CORREO</dt>
                  <dd>{preview.invitedUser.email}</dd>
                </div>
              </dl>
              <div className="activation-note">
                <ShieldCheck size={24} />
                <div>
                  <strong>Tus datos ya están registrados</strong>
                  <p>No necesitas volver a ingresar la información de tu institución.</p>
                </div>
              </div>
            </>
          )}
        </section>
        <section className="activation-panel" aria-live="polite">
          {loading ? (
            <p role="status">Validando tu invitación...</p>
          ) : success ? (
            <>
              <div className="activation-badge">
                <Check size={18} /> CUENTA ACTIVADA
              </div>
              <h2>Cuenta activada</h2>
              <p>Tu acceso como administrador de {preview?.institution.name} está activo.</p>
              <Link className="activation-submit" to="/iniciar-sesion">
                Iniciar sesión <ArrowRight size={20} />
              </Link>
            </>
          ) : preview ? (
            <>
              <div className="activation-badge">
                <Check size={18} /> ESPACIO HABILITADO
              </div>
              <h2>{preview.requiresCredentialSetup ? "Activa tu cuenta" : "Activa tu acceso"}</h2>
              <p>
                {preview.requiresCredentialSetup
                  ? `Define una contraseña para completar la activación y acceder al espacio de ${preview.institution.name}.`
                  : `Esta invitación añadirá tu acceso a ${preview.institution.name}. Conservarás tu contraseña actual.`}
              </p>
              <form onSubmit={activate}>
                {preview.requiresCredentialSetup && (
                  <>
                    <label htmlFor="activation-password">Nueva contraseña</label>
                    <div className="activation-password">
                      <LockKeyhole size={20} />
                      <input
                        id="activation-password"
                        name="password"
                        type={visible ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        disabled={submitting}
                        value={password}
                        onChange={(event) => {
                          setPassword(event.target.value);
                          setError("");
                        }}
                        placeholder="Ingresa tu nueva contraseña"
                      />
                      <button
                        type="button"
                        onClick={() => setVisible(!visible)}
                        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
                        title={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
                      >
                        {visible ? <EyeOff size={19} /> : <Eye size={19} />} {visible ? "Ocultar" : "Mostrar"}
                      </button>
                    </div>
                    <small className="activation-help">
                      Usa al menos 15 caracteres. Puedes usar una frase larga con espacios. Evita contraseñas
                      comunes o reutilizadas.
                    </small>
                    <div className="activation-length" aria-live="polite">
                      <div className="activation-length-heading">
                        <span>Longitud de la contraseña</span>
                        <span>
                          {passwordLength > 128
                            ? "Máximo 128 caracteres"
                            : lengthValid
                              ? "Mínimo cumplido"
                              : `${passwordLength} de 15 caracteres`}
                        </span>
                      </div>
                      <div
                        className={`activation-length-track${passwordLength > 128 ? " activation-length-over" : lengthValid ? " activation-length-ready" : ""}`}
                        role="progressbar"
                        aria-label="Progreso del requisito de longitud"
                        aria-valuemin={0}
                        aria-valuemax={15}
                        aria-valuenow={Math.min(passwordLength, 15)}
                      >
                        <span style={{ width: `${Math.min((passwordLength / 15) * 100, 100)}%` }} />
                      </div>
                    </div>
                    <label htmlFor="activation-confirm-password" className="activation-confirm-label">
                      Confirmar contraseña
                    </label>
                    <div className="activation-password">
                      <LockKeyhole size={20} />
                      <input
                        id="activation-confirm-password"
                        name="confirmPassword"
                        type={confirmVisible ? "text" : "password"}
                        autoComplete="new-password"
                        required
                        disabled={submitting}
                        value={confirmation}
                        onChange={(event) => {
                          setConfirmation(event.target.value);
                          setError("");
                        }}
                        aria-invalid={confirmation.length > 0 && !confirmationMatches}
                        aria-describedby="activation-confirm-status"
                        placeholder="Repite tu nueva contraseña"
                      />
                      <button
                        type="button"
                        onClick={() => setConfirmVisible(!confirmVisible)}
                        aria-label={confirmVisible ? "Ocultar confirmación" : "Mostrar confirmación"}
                        title={confirmVisible ? "Ocultar confirmación" : "Mostrar confirmación"}
                      >
                        {confirmVisible ? <EyeOff size={19} /> : <Eye size={19} />}{" "}
                        {confirmVisible ? "Ocultar" : "Mostrar"}
                      </button>
                    </div>
                    <small
                      id="activation-confirm-status"
                      className={`activation-confirm-status${confirmation.length > 0 && !confirmationMatches ? " activation-confirm-mismatch" : ""}`}
                      aria-live="polite"
                    >
                      {confirmation.length === 0
                        ? "Escribe de nuevo la contraseña para confirmarla."
                        : confirmationMatches
                          ? "Las contraseñas coinciden."
                          : "Las contraseñas no coinciden."}
                    </small>
                  </>
                )}
                {error && (
                  <p role="alert" className="activation-error">
                    {error}
                  </p>
                )}
                <button className="activation-submit" disabled={submitting}>
                  {submitting
                    ? "Activando..."
                    : preview.requiresCredentialSetup
                      ? "Activar cuenta"
                      : "Activar acceso"}
                  <ArrowRight size={20} />
                </button>
              </form>
              <div className="activation-note">
                <LockKeyhole size={21} />
                <div>
                  <strong>Invitación personal</strong>
                  <p>Este enlace expira y solo puede utilizarse una vez.</p>
                </div>
              </div>
            </>
          ) : (
            <>
              <h2>Enlace no disponible</h2>
              <p role="alert">{error}</p>
              <Link className="activation-submit" to="/">
                Volver al inicio
              </Link>
            </>
          )}
        </section>
      </main>
      <footer className="activation-footer">
        <Brand />
        <Link to="/">Volver al inicio</Link>
      </footer>
    </div>
  );
}
