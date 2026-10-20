import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, LockKeyhole, ShieldCheck } from "lucide-react";
import { Brand } from "../../components/Brand";
import "./activation.css";

type Preview = {
  valid: true;
  role: "OPERATOR";
  name: string;
  email: string;
  requiresCredentialSetup: boolean;
};
const base = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
async function request<T>(operation: "preview" | "accept", body: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${base}/platform-invitations/${operation}`, {
    method: "POST",
    cache: "no-store",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.message === "string" ? data.message : "No se pudo validar la invitación.");
  }
  return response.json() as Promise<T>;
}

export function OperatorActivationPage() {
  const [token, setToken] = useState(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(window.history.state, "", window.location.pathname);
    return value;
  });
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(token));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    request<Preview>("preview", { token }, controller.signal)
      .then(setPreview)
      .catch((reason: Error) => {
        if (!controller.signal.aborted) setError(reason.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [token]);
  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !preview || busy) return;
    if (preview.requiresCredentialSetup && password.normalize("NFC") !== confirmation.normalize("NFC")) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await request("accept", preview.requiresCredentialSetup ? { token, password } : { token });
      setToken(null);
      setPassword("");
      setConfirmation("");
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo activar el acceso.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="activation-page">
      <header className="activation-header">
        <Brand dark />
        <Link to="/admin/login">Iniciar sesión</Link>
      </header>
      <main className="activation-main">
        <section className="activation-intro">
          <p className="activation-eyebrow">EQUIPO INTERNO</p>
          <h1>
            Tu acceso a <span>DoggyCredit</span>
          </h1>
          <p>Has recibido una invitación para trabajar como operador de Doggy Software.</p>
          {preview && (
            <div className="activation-institution">
              <ShieldCheck size={32} />
              <div>
                <strong>{preview.name}</strong>
                <small>{preview.email} · Operador</small>
              </div>
            </div>
          )}
        </section>
        <section className="activation-panel" aria-live="polite">
          {loading ? (
            <p role="status">Validando invitación...</p>
          ) : done ? (
            <>
              <div className="activation-badge">
                <Check size={18} /> ACCESO ACTIVADO
              </div>
              <h2>Ya puedes iniciar sesión</h2>
              <p>Usa tu correo para entrar al panel interno.</p>
              <Link className="activation-submit" to="/admin/login">
                Iniciar sesión <ArrowRight size={18} />
              </Link>
            </>
          ) : preview ? (
            <>
              <h2>Activar acceso interno</h2>
              <p>
                {preview.requiresCredentialSetup
                  ? "Define una contraseña para tu nueva cuenta."
                  : "Conservarás la contraseña que ya utilizas en DoggyCredit."}
              </p>
              <form onSubmit={accept}>
                {preview.requiresCredentialSetup && (
                  <>
                    <label htmlFor="operator-password">Nueva contraseña</label>
                    <div className="activation-password">
                      <LockKeyhole size={20} />
                      <input
                        id="operator-password"
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        minLength={15}
                        maxLength={128}
                        required
                      />
                    </div>
                    <p className="activation-help">Usa entre 15 y 128 caracteres.</p>
                    <label htmlFor="operator-confirm">Confirma la contraseña</label>
                    <div className="activation-password">
                      <LockKeyhole size={20} />
                      <input
                        id="operator-confirm"
                        type="password"
                        autoComplete="new-password"
                        value={confirmation}
                        onChange={(event) => setConfirmation(event.target.value)}
                        required
                      />
                    </div>
                  </>
                )}
                <button className="activation-submit" disabled={busy}>
                  {busy ? "Activando..." : "Activar acceso"} <ArrowRight size={18} />
                </button>
              </form>
            </>
          ) : (
            <>
              <h2>Enlace no disponible</h2>
              <p>Solicita un nuevo enlace al administrador de plataforma.</p>
            </>
          )}
          {!token && !done && !loading && !error && <p role="alert">El enlace de activación no es válido.</p>}
          {error && (
            <p className="activation-error" role="alert">
              {error}
            </p>
          )}
        </section>
      </main>
    </div>
  );
}
