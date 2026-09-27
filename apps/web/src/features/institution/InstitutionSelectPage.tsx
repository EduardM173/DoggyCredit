import { useEffect, useState } from "react";
import { Building2, LogOut } from "lucide-react";
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
  return (
    <main className="institution-selection">
      <Brand />
      <h1>{me?.activeMemberships.length ? "Elige tu institución" : "Acceso institucional"}</h1>
      {error && <p role="alert">{error}</p>}
      {!me && !error && <p role="status">Comprobando sesión...</p>}
      {me?.activeMemberships.length === 0 && <p>No tienes acceso institucional activo.</p>}
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
    </main>
  );
}
