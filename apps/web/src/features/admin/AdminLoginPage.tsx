import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, FileText, LockKeyhole, Mail, ShieldCheck, Users } from "lucide-react";
import { Brand } from "../../components/Brand";
import { adminApi, type Session } from "./api";

export function AdminLoginPage() {
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    adminApi<Session>("/auth/session", { signal: controller.signal })
      .then(() => navigate("/admin/solicitudes", { replace: true }))
      .catch(() => {});
    return () => controller.abort();
  }, [navigate]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    try {
      await adminApi<Session>("/auth/login", {
        body: { email: String(data.get("email")).trim(), password: data.get("password") },
      });
      form.reset();
      navigate("/admin/solicitudes", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo iniciar sesión.");
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  return (
    <div className="admin-login">
      <div className="admin-login-art" aria-hidden="true">
        <img src="/images/admin-login-background.webp" alt="" />
      </div>
      <main className="admin-login-main">
        <section className="admin-login-intro">
          <Brand />
          <h1>
            Administración interna de <span>DoggyCredit</span>
          </h1>
          <p>Área exclusiva para el personal de Doggy Software.</p>
          <ul>
            <li>
              <FileText />
              <div>
                <strong>Revisión de solicitudes</strong>
                <p>Evaluación y seguimiento de instituciones.</p>
              </div>
            </li>
            <li>
              <Users />
              <div>
                <strong>Gestión de instituciones</strong>
                <p>Operación interna de la plataforma.</p>
              </div>
            </li>
            <li>
              <ShieldCheck />
              <div>
                <strong>Acceso seguro y trazabilidad</strong>
                <p>Control de acceso y registro de decisiones.</p>
              </div>
            </li>
          </ul>
        </section>
        <section className="admin-login-panel" aria-labelledby="login-title">
          <p className="admin-eyebrow">ADMINISTRACIÓN</p>
          <h2 id="login-title">Iniciar sesión</h2>
          <p>Acceso exclusivo para personal autorizado.</p>
          <form onSubmit={submit}>
            <label htmlFor="admin-email">Correo electrónico</label>
            <div className="admin-input-icon">
              <Mail size={20} />
              <input
                id="admin-email"
                name="email"
                type="email"
                autoComplete="username"
                required
                maxLength={254}
                placeholder="nombre@doggysoftware.com"
                disabled={busy}
              />
            </div>
            <label htmlFor="admin-password">Contraseña</label>
            <div className="admin-input-icon">
              <LockKeyhole size={20} />
              <input
                id="admin-password"
                name="password"
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                required
                maxLength={128}
                disabled={busy}
              />
              <button
                type="button"
                className="admin-icon-button"
                title={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
                aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
                aria-pressed={visible}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            {error && (
              <p className="admin-alert" role="alert">
                {error}
              </p>
            )}
            <button className="button admin-primary" disabled={busy}>
              {busy ? "Iniciando sesión..." : "Iniciar sesión"}
              <ArrowRight size={20} />
            </button>
          </form>
          <div className="admin-login-notice">
            <LockKeyhole />
            <div>
              <strong>Solo personal autorizado</strong>
              <small>Entorno interno de Doggy Software.</small>
            </div>
          </div>
        </section>
      </main>
      <footer className="admin-login-footer">
        <Brand />
        <Link to="/">Volver al sitio público</Link>
      </footer>
    </div>
  );
}
