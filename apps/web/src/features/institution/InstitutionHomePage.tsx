import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Building2, CheckCircle2, House, ListChecks, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";
import { Brand } from "../../components/Brand";
import { institutionApi, InstitutionError, type InstitutionHome } from "./api";

const roleLabel: Record<string, string> = {
  INSTITUTION_ADMIN: "Administrador inicial",
  ANALYST: "Analista",
};
const typeLabel: Record<string, string> = {
  BANK: "Banco",
  FINANCIAL_INSTITUTION: "Financiera",
  COOPERATIVE: "Cooperativa",
  OTHER: "Otra",
};

export function InstitutionHomePage() {
  const { tenantSlug } = useParams();
  const navigate = useNavigate();
  const [home, setHome] = useState<InstitutionHome | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    institutionApi<InstitutionHome>(`/tenants/${encodeURIComponent(tenantSlug ?? "")}/home`, {
      signal: controller.signal,
    })
      .then((value) => {
        setHome(value);
        setError("");
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setHome(null);
        if (reason instanceof InstitutionError && reason.status === 401)
          navigate(`/iniciar-sesion?returnTo=${encodeURIComponent(`/${tenantSlug}`)}`, { replace: true });
        else setError(reason instanceof Error ? reason.message : "No se pudo cargar el espacio.");
      });
    return () => controller.abort();
  }, [navigate, tenantSlug]);
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
          <>
            <p role="alert">{error}</p>
            <Link to="/elegir-institucion">Mis instituciones</Link>
          </>
        ) : (
          <p role="status">Comprobando acceso...</p>
        )}
      </main>
    );
  return (
    <div className="institution-shell">
      <aside className="institution-sidebar">
        <Brand dark />
        <small>Institución</small>
        <nav aria-label="Portal institucional">
          <span className="institution-nav-active">
            <House size={20} /> Inicio
          </span>
        </nav>
        <button onClick={logout} disabled={busy}>
          <LogOut size={20} /> Cerrar sesión
        </button>
      </aside>
      <div className="institution-workspace">
        <header className="institution-topbar">
          <div className="institution-current">
            <Building2 size={22} />
            <strong>{home.tenant.name}</strong>
          </div>
          <div className="institution-person">
            <strong>{home.user.name}</strong>
            <small>{roleLabel[home.membership.role] ?? home.membership.role}</small>
          </div>
        </header>
        <main className="institution-dashboard">
          <p className="institution-eyebrow">INICIO</p>
          <h1>Bienvenida, {home.user.name.split(/\s+/)[0]}</h1>
          <p className="institution-lead">Este es el espacio de {home.tenant.name} en DoggyCredit.</p>
          <div className="institution-home-grid">
            <section className="institution-home-panel">
              <CheckCircle2 className="institution-panel-icon success" size={42} />
              <div>
                <h2>Espacio institucional activo</h2>
                <dl>
                  <dt>Institución</dt>
                  <dd>{home.tenant.name}</dd>
                  <dt>Rol</dt>
                  <dd>{roleLabel[home.membership.role] ?? home.membership.role}</dd>
                  <dt>Estado de la cuenta</dt>
                  <dd>Activa</dd>
                  <dt>Acceso</dt>
                  <dd>Correcto y seguro</dd>
                </dl>
              </div>
            </section>
            <section className="institution-home-panel">
              <LockKeyhole className="institution-panel-icon" size={42} />
              <div>
                <h2>Acceso seguro a tu institución</h2>
                <p>
                  Tu acceso está limitado a {home.tenant.name}. La institución se reconoce automáticamente al
                  iniciar sesión.
                </p>
              </div>
            </section>
            <section className="institution-home-panel">
              <Building2 className="institution-panel-icon" size={42} />
              <div>
                <h2>Información de la institución</h2>
                <dl>
                  <dt>Nombre o razón social</dt>
                  <dd>{home.tenant.name}</dd>
                  <dt>NIT</dt>
                  <dd>{home.tenant.taxId}</dd>
                  <dt>Tipo de institución</dt>
                  <dd>{typeLabel[home.tenant.type] ?? home.tenant.type}</dd>
                </dl>
              </div>
            </section>
            <section className="institution-home-panel">
              <ListChecks className="institution-panel-icon" size={42} />
              <div>
                <h2>Próximas etapas</h2>
                <p>La configuración de fuentes, productos y equipos estará disponible en próximas etapas.</p>
                <p className="institution-muted">
                  <ShieldCheck size={18} /> Las evaluaciones y los reportes aparecerán cuando esas funciones
                  estén habilitadas.
                </p>
              </div>
            </section>
          </div>
          {error && (
            <p role="alert" className="institution-error">
              {error}
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
