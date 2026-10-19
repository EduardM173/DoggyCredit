import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, CreditCard, FileText, Inbox, LogOut, PlugZap } from "lucide-react";
import { Brand } from "../../components/Brand";
import { adminApi, AdminError, type Session } from "./api";

export function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    adminApi<Session>("/auth/session", { signal: controller.signal })
      .then(setSession)
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        if (e instanceof AdminError && e.status === 401) navigate("/admin/login", { replace: true });
        else setError(e instanceof Error ? e.message : "No se pudo cargar tu sesión.");
      });
    return () => controller.abort();
  }, [navigate, attempt]);
  const isPlatformAdmin = session?.user.platformRole === "PLATFORM_ADMIN";
  useEffect(() => {
    // HU-30: el administrador de plataforma solo trabaja en Proveedores; las pantallas de operador le darían 403.
    if (isPlatformAdmin && !location.pathname.startsWith("/admin/proveedores"))
      navigate("/admin/proveedores", { replace: true });
  }, [isPlatformAdmin, location.pathname, navigate]);
  async function logout() {
    setBusy(true);
    try {
      await adminApi("/auth/logout", { body: {} });
      setSession(null);
      navigate("/admin/login", { replace: true });
    } catch {
      setError("No se pudo cerrar la sesión. Intenta nuevamente.");
    } finally {
      setBusy(false);
    }
  }
  if (!session)
    return (
      <main className="admin-gate">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button
              className="button"
              onClick={() => {
                setError("");
                setAttempt(attempt + 1);
              }}
            >
              Reintentar
            </button>
            <Link to="/admin/login">Volver al inicio de sesión</Link>
          </>
        ) : (
          <p role="status">Comprobando sesión...</p>
        )}
      </main>
    );
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Brand dark />
        <p className="admin-brand-caption">Administración</p>
        <nav aria-label="Administración">
          {isPlatformAdmin ? (
            <NavLink to="/admin/proveedores">
              <PlugZap size={21} />
              Proveedores
            </NavLink>
          ) : (
            <>
              <NavLink to="/admin/solicitudes">
                <FileText size={21} />
                Solicitudes
              </NavLink>
              <NavLink to="/admin/contrataciones">
                <CreditCard size={21} />
                Contrataciones
              </NavLink>
              <NavLink to="/admin/instituciones">
                <Building2 size={21} />
                Instituciones
              </NavLink>
              <NavLink to="/admin/bandeja-pruebas">
                <Inbox size={21} />
                Bandeja de pruebas
              </NavLink>
            </>
          )}
        </nav>
        <Link className="admin-public-link" to="/">
          <ArrowLeft size={20} />
          Volver al sitio público
        </Link>
      </aside>
      <div className="admin-workspace">
        <header className="admin-topbar">
          <span className="admin-avatar">
            {session.user.fullName
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0])
              .join("")}
          </span>
          <div>
            <strong>{session.user.fullName}</strong>
            <small>{isPlatformAdmin ? "Administrador de plataforma" : "Operador"}</small>
          </div>
          <button
            className="admin-icon-button"
            onClick={logout}
            disabled={busy}
            title="Cerrar sesión"
            aria-label="Cerrar sesión"
          >
            <LogOut size={20} />
          </button>
        </header>
        {error && (
          <p className="admin-alert" role="alert">
            {error}
          </p>
        )}
        <main className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
