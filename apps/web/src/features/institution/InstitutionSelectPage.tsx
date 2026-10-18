import { useEffect, useState } from "react";
import { Building2, LockKeyhole, LogOut } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Brand } from "../../components/Brand";
import { destination, institutionApi, InstitutionError, type InstitutionMe } from "./api";

export function InstitutionSelectPage() {
  const navigate = useNavigate();
  const [me, setMe] = useState<InstitutionMe | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    institutionApi<InstitutionMe>("/auth/me", { signal: controller.signal })
      .then((value) => {
        if (value.activeMemberships.length === 1) navigate(destination(value, null), { replace: true });
        else setMe(value);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof InstitutionError && reason.status === 401)
          navigate("/iniciar-sesion", { replace: true });
        else setError("No se pudieron cargar tus instituciones.");
      });
    return () => controller.abort();
  }, [navigate]);
  async function logout() {
    try {
      await institutionApi("/auth/logout", { body: {} });
      navigate("/iniciar-sesion", { replace: true });
    } catch {
      setError("No se pudo cerrar la sesión.");
    }
  }
  const noActiveMemberships = me?.activeMemberships.length === 0;
  return (
    <main className={`institution-selection${noActiveMemberships ? " institution-selection-empty" : ""}`}>
      {noActiveMemberships ? (
        <>
          <header className="institution-selection-header">
            <Brand />
          </header>
          <div className="institution-selection-state-area">
            <section
              className="institution-selection-state"
              aria-labelledby="institution-selection-state-title"
            >
              <span className="institution-selection-state-icon" aria-hidden="true">
                <LockKeyhole size={24} />
              </span>
              <h1 id="institution-selection-state-title">Sin acceso institucional activo</h1>
              <p>Por ahora no hay ninguna institución disponible para esta cuenta.</p>
              {error && <p role="alert">{error}</p>}
              <button className="institution-selection-logout" onClick={logout}>
                <LogOut size={18} /> Cerrar sesión
              </button>
            </section>
          </div>
        </>
      ) : (
        <>
          <Brand />
          <h1>{me?.activeMemberships.length ? "Elige tu institución" : "Acceso institucional"}</h1>
          {error && <p role="alert">{error}</p>}
          {!me && !error && <p role="status">Comprobando sesión...</p>}
          {me && me.activeMemberships.length > 1 && (
            <div className="institution-selection-list">
              {me.activeMemberships.map(({ tenant }) => (
                <button key={tenant.slug} onClick={() => navigate(`/${tenant.slug}`)}>
                  <Building2 size={24} /> {tenant.name}
                </button>
              ))}
            </div>
          )}
          {me && (
            <button className="institution-text-button" onClick={logout}>
              <LogOut size={18} /> Cerrar sesión
            </button>
          )}
        </>
      )}
    </main>
  );
}
