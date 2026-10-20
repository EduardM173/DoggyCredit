import { useEffect, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { Brand } from "../../components/Brand";
import "./password-recovery.css";

const genericMessage =
  "Si existe una cuenta asociada a este correo, recibirás instrucciones para recuperar el acceso.";

async function recoveryApi<T>(action: "request" | "preview" | "complete", body: object): Promise<T> {
  const base = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
  const response = await fetch(`${base}/password-recovery/${action}`, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    if (response.status === 429) throw new Error("Demasiados intentos. Espera antes de volver a intentar.");
    if (action === "request")
      throw new Error("El servicio no está disponible ahora. Inténtalo de nuevo más tarde.");
    const data = await response.json().catch(() => ({}));
    throw new Error(
      typeof data.message === "string" && response.status === 400
        ? data.message
        : "No se pudo completar la operación. Inténtalo de nuevo.",
    );
  }
  return response.json();
}

export function PasswordRecoveryPage({ reset = false }: { reset?: boolean }) {
  const [search] = useSearchParams();
  const internal = search.get("from") === "internal";
  const loginPath = internal ? "/admin/login" : "/iniciar-sesion";
  const requestPath = internal ? "/recuperar-contrasena?from=internal" : "/recuperar-contrasena";
  const [token, setToken] = useState<string | null>(() => {
    if (!reset) return null;
    const value =
      new URLSearchParams(window.location.hash.slice(1)).get("token") ||
      new URLSearchParams(window.location.search).get("token");
    window.history.replaceState(
      window.history.state,
      "",
      window.location.pathname + (internal ? "?from=internal" : ""),
    );
    return value;
  });
  const [valid, setValid] = useState(false);
  const [checking, setChecking] = useState(reset && !!token);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!reset || !token) return;
    let active = true;
    recoveryApi<{ valid: true }>("preview", { token })
      .then(() => {
        if (active) setValid(true);
      })
      .catch((reason: unknown) => {
        if (active)
          setError(reason instanceof Error ? reason.message : "No se pudo comprobar el enlace.");
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [reset, token]);

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await recoveryApi("request", { email: String(data.get("email")).trim() });
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo enviar la solicitud.");
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;
    setError("");
    const length = Array.from(password.normalize("NFC")).length;
    if (length < 15 || length > 128) {
      setError("La contraseña debe tener entre 15 y 128 caracteres.");
      return;
    }
    if (password.normalize("NFC") !== confirmation.normalize("NFC")) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    try {
      await recoveryApi("complete", { token, password, confirmation });
      setPassword("");
      setConfirmation("");
      setToken(null);
      setDone(true);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "No se pudo restablecer la contraseña.";
      setError(message);
      if (message.startsWith("El enlace no es válido")) setValid(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="password-recovery-page">
      <header className="password-recovery-header">
        <Brand dark />
      </header>
      <main className="password-recovery-main">
        <section className="password-recovery-panel" aria-live="polite">
          {done ? (
            <>
              <span className="password-recovery-icon">
                <Check size={24} />
              </span>
              <h1>{reset ? "Contraseña actualizada" : "Revisa tu correo"}</h1>
              <p>{reset ? "Ya puedes iniciar sesión con tu nueva contraseña." : genericMessage}</p>
              {!reset && (
                <p>Si el correo tarda o el servicio está temporalmente no disponible, inténtalo de nuevo más tarde.</p>
              )}
              <Link className="password-recovery-primary" to={loginPath}>
                Iniciar sesión <ArrowRight size={18} />
              </Link>
              {!reset && (
                <button className="password-recovery-retry" type="button" onClick={() => setDone(false)}>
                  Solicitar otro enlace
                </button>
              )}
            </>
          ) : reset ? (
            <>
              <span className="password-recovery-icon">
                <LockKeyhole size={24} />
              </span>
              <h1>Establecer nueva contraseña</h1>
              {checking ? (
                <p role="status">Comprobando el enlace...</p>
              ) : valid ? (
                <>
                  <p>Define una contraseña nueva para tu cuenta de DoggyCredit.</p>
                  <form onSubmit={submitReset}>
                    <label htmlFor="recovery-password">Nueva contraseña</label>
                    <div className="password-recovery-input">
                      <input
                        id="recovery-password"
                        type={visible ? "text" : "password"}
                        autoComplete="new-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        required
                        disabled={busy}
                        aria-describedby="recovery-requirements"
                      />
                      <button
                        type="button"
                        onClick={() => setVisible(!visible)}
                        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
                      >
                        {visible ? <EyeOff size={20} /> : <Eye size={20} />}
                      </button>
                    </div>
                    <small id="recovery-requirements">
                      Usa entre 15 y 128 caracteres. Puedes usar una frase larga.
                    </small>
                    <label htmlFor="recovery-confirmation">Confirmar contraseña</label>
                    <div className="password-recovery-input">
                      <input
                        id="recovery-confirmation"
                        type={visible ? "text" : "password"}
                        autoComplete="new-password"
                        value={confirmation}
                        onChange={(event) => setConfirmation(event.target.value)}
                        required
                        disabled={busy}
                        aria-describedby={error ? "recovery-error" : undefined}
                      />
                    </div>
                    {error && (
                      <p id="recovery-error" className="password-recovery-error" role="alert">
                        {error}
                      </p>
                    )}
                    <button className="password-recovery-primary" disabled={busy}>
                      {busy ? "Guardando..." : "Guardar nueva contraseña"} <ArrowRight size={18} />
                    </button>
                  </form>
                </>
              ) : (
                <>
                  <p role="alert">{error || "El enlace no es válido, venció o ya fue utilizado."}</p>
                  <Link className="password-recovery-primary" to={requestPath}>
                    Solicitar un enlace nuevo <ArrowRight size={18} />
                  </Link>
                </>
              )}
            </>
          ) : (
            <>
              <span className="password-recovery-icon">
                <Mail size={24} />
              </span>
              <h1>Recuperar contraseña</h1>
              <p>Escribe el correo de tu cuenta y te enviaremos instrucciones para recuperar el acceso.</p>
              <form onSubmit={submitRequest}>
                <label htmlFor="recovery-email">Correo electrónico</label>
                <div className="password-recovery-input">
                  <input
                    id="recovery-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    disabled={busy}
                    aria-describedby={error ? "recovery-error" : undefined}
                  />
                </div>
                {error && (
                  <p id="recovery-error" className="password-recovery-error" role="alert">
                    {error}
                  </p>
                )}
                <button className="password-recovery-primary" disabled={busy}>
                  {busy ? "Enviando..." : "Enviar enlace de recuperación"} <ArrowRight size={18} />
                </button>
              </form>
            </>
          )}
          <Link className="password-recovery-back" to={loginPath}>
            <ArrowLeft size={18} /> Volver a iniciar sesión
          </Link>
        </section>
      </main>
    </div>
  );
}
