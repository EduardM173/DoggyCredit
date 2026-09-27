import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { ArrowLeft, Building2, CreditCard, FileText, LogOut } from "lucide-react";
import { Brand } from "../../components/Brand";
import { adminApi, AdminError, type Session } from "./api";

export function AdminLayout() {
  const navigate = useNavigate();
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
          <NavLink to="/admin/solicitudes">
            <FileText size={21} />
            Solicitudes
          </NavLink>
          <button disabled title="Disponible en una próxima historia">
            <CreditCard size={21} />
            Contrataciones
          </button>
          <button disabled title="Disponible en una próxima historia">
            <Building2 size={21} />
            Instituciones
          </button>
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
            <small>Operador</small>
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
