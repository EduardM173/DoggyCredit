import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, FileText, HelpCircle, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { Brand } from "../../components/Brand";
import { PublicInfo } from "../../components/PublicInfo";
import { destination, institutionApi, type InstitutionMe, type LoginResolution } from "./api";
import "./institution.css";

export function InstitutionLoginPage() {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    institutionApi<InstitutionMe>("/auth/me", { signal: controller.signal })
      .then((me) => navigate(destination(me, search.get("returnTo")), { replace: true }))
      .catch(() => {});
    return () => controller.abort();
  }, [navigate, search]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await institutionApi<LoginResolution>("/auth/login", {
        body: { email: String(data.get("email")).trim(), password: String(data.get("password")) },
      });
      const me = await institutionApi<InstitutionMe>("/auth/me");
      form.reset();
      navigate(destination(me, search.get("returnTo")), { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo iniciar sesión.");
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  return (
    <div className="institution-login">
      <header className="institution-login-header">
        <Brand dark />
        <PublicInfo kind="contact" className="institution-help">
          <HelpCircle size={20} /> ¿Necesitas ayuda?
        </PublicInfo>
      </header>
      <main className="institution-login-main">
        <div className="institution-login-art" aria-hidden="true" />
        <section className="institution-login-intro">
          <p className="institution-eyebrow">PORTAL INSTITUCIONAL</p>
          <h1>
            Bienvenido a <span>DoggyCredit</span>
          </h1>
          <p>Accede al espacio seguro de tu institución.</p>
          <ul>
            <li>
              <FileText />
              <div>
                <strong>Evaluaciones y recomendaciones</strong>
                <p>Información organizada para apoyar decisiones crediticias.</p>
              </div>
            </li>
            <li>
              <ShieldCheck />
              <div>
                <strong>Espacio institucional protegido</strong>
                <p>Tu acceso está asociado únicamente a tus instituciones autorizadas.</p>
              </div>
            </li>
          </ul>
        </section>
        <section className="institution-login-panel" aria-labelledby="institution-login-title">
          <h2 id="institution-login-title">Inicia sesión</h2>
          <p>Accede al portal institucional de DoggyCredit.</p>
          <form onSubmit={submit}>
            <label htmlFor="institution-email">Correo electrónico</label>
            <div className="institution-input">
              <Mail size={20} />
              <input
                id="institution-email"
                name="email"
                type="email"
                autoComplete="username"
                required
                maxLength={254}
                placeholder="tu@institucion.com"
                disabled={busy}
              />
            </div>
            <label htmlFor="institution-password">Contraseña</label>
            <div className="institution-input">
              <LockKeyhole size={20} />
              <input
                id="institution-password"
                name="password"
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                required
                disabled={busy}
                placeholder="Ingresa tu contraseña"
              />
              <button
                type="button"
                onClick={() => setVisible(!visible)}
                aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
                title={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {visible ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            {error && (
              <p role="alert" className="institution-error">
                {error}
              </p>
            )}
            <button className="institution-submit" disabled={busy}>
              {busy ? "Iniciando sesión..." : "Iniciar sesión"} <ArrowRight size={20} />
            </button>
          </form>
          <p className="institution-invite-note">
            ¿Aún no activaste tu cuenta?
            <br />
            Usa el enlace de invitación que recibiste por correo.
          </p>
        </section>
      </main>
      <footer className="institution-login-footer">
        <Brand />
        <Link to="/">Volver al sitio público</Link>
      </footer>
    </div>
  );
}
